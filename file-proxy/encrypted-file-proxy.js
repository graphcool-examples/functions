'use latest';

import Webtask from 'webtask-tools';
import express from 'express';
import crypto from 'crypto';
import multiparty from 'multiparty';
import formData from 'form-data';
import request from 'request';
import { request as gqlrequest } from 'graphql-request';

const app = express();

// The upload endpoint
app.post('/:projectId', (req, res) => {
  const webtaskName = req.originalUrl.split('/')[1];
  const projectId = req.params.projectId;
  const graphCoolFileEndpoint = `https://api.graph.cool/file/v1/${projectId}`;
  const graphCoolSimpleEndpoint = `https://api.graph.cool/simple/v1/${projectId}`;

  // We set up a new multiparty form to process our request later on
  const form = new multiparty.Form();

  // Multiparty generates a 'part' event for every file in the request
  // This implementation assumes a single file is posted
  form.on('part', part => {
    // This is the encryption method. The password used for encryption is taken from a secrets
    // Warning: this is *NOT* production ready encryption, but a simplified example
    const cipher = crypto.createCipher('aes256', req.webtaskContext.secrets.FILE_ENC_PASSWORD);

    // We construct a new form for posting to the actual Graphcool File API
    const formdata = new formData();
    // To reduce memory footprint for large file uploads, we use streaming
    formdata.append('data', part.pipe(cipher), { filename: part.filename, contentType: part['content-type'] });

    // Post the constructed form to the Graphcool File API
    request.post(graphCoolFileEndpoint,
      {
        headers: {'transfer-encoding': 'chunked'},
        _form: formdata
      }, (err, resp, body) => {
        const result = JSON.parse(body);

        // The File API has created a File node. We need to update the URL to
        // point to our own endpoint. Unfortunately, we can't, so we use a new
        // field on the File Type to store our URL.
        const query = `
          mutation updateFile($id: ID!, $newUrl: String!) {
            updateFile (id: $id, newUrl: $newUrl)
            { name size newUrl id contentType }
          }`;

        const variables = {
          id: result.id,
          newUrl: result.url.replace('files.graph.cool', `${req.headers.host}/${webtaskName}`)
        };

        gqlRequest(graphCoolSimpleEndpoint, query, variables)
          .then(data => res.status(200).send(data.updateFile));
      });
  });

  // Let multiparty parse the incoming request
  form.parse(req);
});

// The download endpoint
app.get('/:projectId/:fileId', (req, res) => {
  // The decryption method, using the same secret password
  const decipher = crypto.createDecipher('aes256', req.webtaskContext.secrets.FILE_ENC_PASSWORD);

  // The request to the actual file
  const resource = request.get(`https://files.graph.cool/${req.params.projectId}/${req.params.fileId}`);

  // As soon as we get a response, we copy the headers
  // Content-length is removed, because the decrypted file does not have the same length
  resource.on('response', (response) => {
    res.set(response.headers);
    res.removeHeader('content-length');
  });

  // To reduce the memory footprint, we use streaming again
  resource.pipe(decipher).pipe(res);
});

export default Webtask.fromExpress(app);
