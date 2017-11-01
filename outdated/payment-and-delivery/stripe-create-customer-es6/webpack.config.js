const webpack = require('webpack');
const path = require('path');
const nodeExternals = require('webpack-node-externals');
const functionToBuild = 'createStripeCustomer';

module.exports = {
  entry: ['babel-polyfill', `./src/${functionToBuild}`],
  output: {
    path: path.join(__dirname, 'dist'),
    library: '[name]',
    libraryTarget: 'commonjs2',
    filename: `${functionToBuild}.js`
  },
  externals: [nodeExternals({
    whitelist: ['babel-polyfill', 'regenerator-runtime/runtime']}
  )],
  target: 'node',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
        options: {
          presets: ['es2015'],
        }
      }
    ]
  },
  plugins: [
    new webpack.optimize.UglifyJsPlugin({
      compress: {
        warnings: false,
        screw_ie8: true,
        conditionals: true,
        unused: true,
        comparisons: true,
        sequences: true,
        dead_code: true,
        evaluate: true,
        join_vars: true,
        if_return: true
      },
    }),
  ]
};