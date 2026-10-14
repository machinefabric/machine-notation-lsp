// The server's tests, bundled the way the server is: its modules import one
// another without extensions and capdag is an ES module that waits on its
// proved model, so the tests run from a bundle, not from the sources.
const path = require("path");

/** @type {import('webpack').Configuration} */
module.exports = {
  mode: "development",
  target: "node",
  entry: "./server/test/server.test.ts",
  output: {
    path: path.resolve(__dirname, "out-test"),
    filename: "server.test.js",
    libraryTarget: "commonjs2",
  },
  devtool: "source-map",
  resolve: {
    extensions: [".ts", ".js"],
    symlinks: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader", options: { configFile: path.resolve(__dirname, "server/test/tsconfig.json") } }],
      },
    ],
  },
};
