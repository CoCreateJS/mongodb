/********************************************************************************
 * Copyright (C) 2023-2026 CoCreate and Contributors.
 *
 * Licensed under GNU AGPLv3.
 ********************************************************************************/

import path from "node:path";
import { fileURLToPath } from "node:url";
import webpack from "webpack";
import { EsbuildPlugin } from "esbuild-loader";
import { FileUploader } from "@cocreate/webpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Webpack plugin that converts compiled code into a Base64 string payload
 * wrapped inside a self-executing construct that extracts the file on app startup
 * and nullifies its own reference to trigger immediate V8 garbage collection.
 */
class SelfCleaningBundlePlugin {
    apply(compiler) {
        compiler.hooks.compilation.tap("SelfCleaningBundlePlugin", (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: "SelfCleaningBundlePlugin",
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER
                },
                (assets) => {
                    for (const assetName of Object.keys(assets)) {
                        if (assetName.endsWith(".js")) {
                            const rawSourceCode = assets[assetName].source().toString();
                            const base64Payload = Buffer.from(rawSourceCode, "utf8").toString("base64");

                            const wrappedCode = `/********************************************************************************
 * Copyright (C) 2023-2026 CoCreate and Contributors.
 *
 * Licensed under GNU AGPLv3.
 ********************************************************************************/

import fs from "node:fs";
import path from "node:path";

/**
 * Self-Executing & Self-Cleaning Database Bootstrapper Construct
 * Encapsulates Base64 payload string and releases V8 heap memory immediately upon execution.
 */
let bootstrapperContainer = {
    payload: ${JSON.stringify(base64Payload)},

    extractDatabase() {
        try {
            const storageDir = path.join(process.cwd(), ".storages");
            const dbPath = path.join(storageDir, "mongodb.js");

            // 1. Ensure .storage directory exists
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }

            // 2. Extract embedded payload to disk if missing
            if (!fs.existsSync(dbPath)) {
                if (this.payload) {
                    console.log(\`[Storage Boot] Extracting embedded database payload to: \${dbPath}\`);
                    const dbBuffer = Buffer.from(this.payload, "base64");
                    fs.writeFileSync(dbPath, dbBuffer);
                    console.log("[Storage Boot] Database extraction complete.");
                } else {
                    console.log("[Storage Boot] Database file missing, but no embedded payload present.");
                }
            } else {
                console.log(\`[Storage Boot] MongoDB module present on disk at: \${dbPath}\`);
            }
        } catch (err) {
            console.error("[Storage Boot Error] Failed to extract database payload:", err.message);
        } finally {
            // 3. Dereference Base64 string property inside the container object
            this.payload = null;
        }
    }
};

// 4. Synchronously execute extraction on application launch (no top-level await needed)
if (bootstrapperContainer) {
    bootstrapperContainer.extractDatabase();
    // 5. Completely dereference the variable construct so V8 GC reclaims container object and functions
    bootstrapperContainer = null;
}
`;

                            assets[assetName] = new webpack.sources.RawSource(wrappedCode);
                        }
                    }
                }
            );
        });
    }
}

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
                resourceRegExp: /^(kerberos|@mongodb-js\/zstd|@aws-sdk\/credential-providers|gcp-metadata|snappy|socks|mongodb-client-encryption|aws4|bson-ext|cardinal|\.d\.ts)$/
            }),

            // Encapsulates output bundle as a self-executing Base64 string that cleans V8 RAM
            new SelfCleaningBundlePlugin(),

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