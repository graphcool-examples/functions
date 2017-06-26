'use latest';

import Webtask from 'webtask-tools';
import express from 'express';
import crypto from 'crypto';
import multiparty from 'multiparty';
import formData from 'form-data';
import request from 'request';
import bearerToken from 'express-bearer-token';
import { request as gqlrequest } from 'graphql-request';

const app = express();
app.use(bearerToken());

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
  form.on('part', function(part) {
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
        headers: { 'transfer-encoding': 'chunked' },
        _form: formdata
      }, (err, resp, body) => {
        const result = JSON.parse(body);

        // The File API has created a File node.
        // We create a MyFile node, linked to this File node.
        // This triggers the Permission Queries defined for MyFile
        // Ideally, we want to do this *before* uploading the file,
        // but because we use streaming we cannot do this first.
        // We store the unencrypted file size in MyFile, to use when downloading
        request.post(
          {
            url: graphCoolSimpleEndpoint,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              query: `
              mutation {
                createMyFile (secret: "${result.secret}",
                              name: "${result.name}",
                              size: ${part.byteCount},
                              contentType: "${result.contentType}" ,
                              url: "${result.url.replace('files.graph.cool', `${req.headers.host}/${webtaskName}`)}",
                              fileId: "${result.id}")
                {
                  name
                  size
                  url
                  id
                  contentType
                }
              }`
            })
          },
          (err, resp, body) => {
            const response = JSON.parse(body);
            const newId = response.data && response.data.createMyFile ? response.data.createMyFile.id : null;

            if (!newId && response.errors[0].code == '3008') {
              // If the user is not allowed to create a MyFile node, we return '403 Forbidden'
              // The uploaded file will be cleaned up by our watcher
              res.status(403).send('Unauthorized');
            }
            else {
              // Return the response body to the client, just like the 'normal' File API.
              res.status(200).send(response.data.createMyFile);
            }
          }).auth(null, null, true, req.token ? req.token : null);
      });
  });

  // Let multiparty parse the incoming request
  form.parse(req);
});

// The download endpoint
app.get('/:projectId/:fileSecret', (req, res) => {

  // The decryption method, using the same secret password
  const decipher = crypto.createDecipher('aes256', req.webtaskContext.secrets.FILE_ENC_PASSWORD);

  // First, we read the MyFile node with the user authentication to get the original file URL
  request.post(
    {
      url: `https://api.graph.cool/simple/v1/${req.params.projectId}`,
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        query: `query { MyFile(secret: "${req.params.fileSecret}") { id size file { url } } }`
      })
    },
    (err, resp, body) => {
      const myFileResponse = JSON.parse(body);
      const newId = myFileResponse.data && myFileResponse.data.MyFile ? myFileResponse.data.MyFile.id : null;

      if (!newId && myFileResponse.errors[0].code == '3008') {
        // If the user is not allowed to create a MyFile node, we return '403 Forbidden'
        // The uploaded file will be cleaned up by our watcher
        res.status(403).send('Unauthorized');
      }

      // The request to the actual file
      const resource = request.get(myFileResponse.data.MyFile.file.url);

      // As soon as we get a response, we copy the headers
      // Content-length is overridden with the original, unencrypted file size we stored before
      resource.on('response', (response) => {
        res.set(response.headers);
        res.set('content-length', myFileResponse.data.MyFile.size)
      });

      // To reduce the memory footprint, we use streaming again
      resource.pipe(decipher).pipe(res);

    }).auth(null, null, true, req.token ? req.token : null);
});

export default Webtask.fromExpress(app);
