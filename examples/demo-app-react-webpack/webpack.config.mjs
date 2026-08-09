import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import HtmlWebpackPlugin from "html-webpack-plugin";
import thisoneWebpack from "vite-plugin-thisone/webpack";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  entry: resolve(__dirname, "src/main.jsx"),
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: { presets: ["@babel/preset-react"] },
        },
      },
    ],
  },
  resolve: { extensions: [".js", ".jsx"] },
  plugins: [
    new HtmlWebpackPlugin({
      title: "thisone webpack demo",
      template: resolve(__dirname, "public/index.html"),
    }),
    thisoneWebpack(),
  ],
  devServer: {
    port: Number(process.env.THISONE_E2E_WEBPACK_PORT) || 5195,
  },
};
