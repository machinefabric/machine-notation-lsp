const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require('webpack');

const mode = process.env.BUILD_MODE || 'production';
const isDevelopment = mode === 'development';

/** @type {import('webpack').Configuration} */
const clientConfig = {
  mode,
  target: "node",
  entry: "./client/src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  devtool: isDevelopment ? 'source-map' : false,
  externals: {
    vscode: "commonjs vscode"
  },
  resolve: {
    extensions: [".ts", ".js"],
    symlinks: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader" }],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.BUILD_MODE': JSON.stringify(mode)
    }),
    new CopyPlugin({
      patterns: [{ from: "media", to: "media" }],
    }),
  ],
};

/** @type {import('webpack').Configuration} */
const serverConfig = {
  mode,
  target: "node",
  entry: "./server/src/server.ts",
  output: {
    path: path.resolve(__dirname, "dist/server"),
    filename: "server.js",
    libraryTarget: "commonjs2",
  },
  devtool: isDevelopment ? 'source-map' : false,
  externals: {
    vscode: "commonjs vscode"
  },
  resolve: {
    extensions: [".ts", ".js"],
    symlinks: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader" }],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.BUILD_MODE': JSON.stringify(mode)
    }),
  ],
};

module.exports = [clientConfig, serverConfig];
