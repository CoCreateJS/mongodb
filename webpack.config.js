import webpack from "webpack";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EsbuildPlugin } from "esbuild-loader";
import { FileUploader } from "@cocreate/webpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (env, argv) => {
    const isProduction = argv && argv.mode === "production";

    const config = {
        // Target Node.js environment for Worker Threads execution
        target: "node",

        // Output native ES Module bundle syntax
        experiments: {
            outputModule: true
        },

        // Entry point for the MongoDB database adapter
        entry: {
            "mongodb": "./src/index.js"
        },

        output: {
            path: path.resolve(__dirname, "dist"),
            // Produces 'mongodb.bundle.js'
            filename: "[name].bundle.js",
            library: {
                type: "module"
            },
            clean: true,
            // Retain standard global scope in worker threads
            globalObject: "this"
        },

        resolve: {
            extensions: [".js", ".mjs", ".cjs", ".json"],
            fullySpecified: false
        },

        node: {
            __dirname: false,
            __filename: false
        },

        plugins: [
            // Enforce single-file bundle output without dynamic split chunks
            new webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 1
            }),

            // Ignore optional native drivers, C++ extensions, docs, and non-essential cloud signers
            new webpack.IgnorePlugin({
                resourceRegExp: /^(kerberos|@mongodb-js\/zstd|@aws-sdk\/credential-providers|gcp-metadata|snappy|socks|mongodb-client-encryption|aws4|bson-ext|sparse-bitfield|cardinal|\.d\.ts)$/
            }),

            // Uploads bundled driver script to CDN/HTTP endpoint if configured
            new FileUploader(env, argv)
        ],

        // Disable source map generation completely to eliminate .map files and minimize output size
        devtool: false,
        mode: isProduction ? "production" : "development",

        module: {
            rules: [
                {
                    // Relax strict ESM extension requirements for node_modules resolution
                    test: /\.m?[jc]s$/,
                    type: "javascript/auto",
                    resolve: {
                        fullySpecified: false
                    }
                },
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    use: {
                        loader: "esbuild-loader",
                        options: {
                            loader: "js",
                            target: "node18"
                        }
                    }
                }
            ]
        },

        optimization: {
            minimize: isProduction,
            minimizer: [
                new EsbuildPlugin({
                    target: "node18"
                })
            ],
            // Enforce single-file output by disabling chunk splitting
            splitChunks: false,
            runtimeChunk: false
        },

        performance: {
            hints: false
        }
    };

    return config;
};