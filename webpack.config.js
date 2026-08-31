/********************************************************************************
 * Copyright (C) 2023-2026 CoCreate and Contributors.
 *
 * Licensed under GNU AGPLv3.
 ********************************************************************************/

import path from "node:path";
import { fileURLToPath } from "node:url";
import webpack from "webpack";
import { transformSync } from "esbuild";
import { FileUploader } from "@cocreate/webpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Webpack plugin that converts compiled code into an inline JSON string payload
 * wrapped inside a self-executing bootstrapper construct. Extracts the file on app startup
 * and nullifies its own reference to trigger immediate V8 garbage collection.
 */
class SelfCleaningBundlePlugin {
    constructor(options = {}) {
        this.isProduction = options.isProduction ?? false;
    }

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
                            
                            // JSON.stringify handles escaping and is ~30% smaller on disk than Base64
                            const jsonEscapedPayload = JSON.stringify(rawSourceCode);

                            let wrappedCode = `/********************************************************************************
 * Copyright (C) 2023-2026 CoCreate and Contributors.
 *
 * Licensed under GNU AGPLv3.
 ********************************************************************************/

import fs from "node:fs";
import path from "node:path";

/**
 * Self-Executing & Self-Cleaning Database Bootstrapper Construct
 * Encapsulates JSON payload string and releases V8 heap memory immediately upon execution.
 */
let bootstrapperContainer = {
    payload: ${jsonEscapedPayload},

    extractDatabase() {
        try {
            const storageDir = path.join(process.cwd(), ".storages");
            const dbPath = path.join(storageDir, "mongodb.js");

            // 1. Ensure .storages directory exists
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }

            // 2. Extract embedded payload to disk if missing
            if (!fs.existsSync(dbPath)) {
                if (this.payload) {
                    console.log(\`[Storage Boot] Extracting embedded database payload to: \${dbPath}\`);
                    
                    // Direct UTF-8 write without binary decoding overhead
                    fs.writeFileSync(dbPath, this.payload, "utf8");
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
            // 3. Dereference payload string to allow V8 memory reclaim
            this.payload = null;
        }
    }
};

// 4. Synchronously execute extraction on application launch
if (bootstrapperContainer) {
    bootstrapperContainer.extractDatabase();
    // 5. Dereference container variable for V8 GC reclamation
    bootstrapperContainer = null;
}
`;

                            // If running in production mode, minify the final combined wrapper script
                            if (this.isProduction) {
                                const minifiedResult = transformSync(wrappedCode, {
                                    loader: "js",
                                    target: "node18",
                                    minify: true,
                                    legalComments: "inline"
                                });
                                wrappedCode = minifiedResult.code;
                            }

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

    // Base configuration shared across all build targets
    const baseConfig = {
        target: "node",
        experiments: {
            outputModule: true
        },
        resolve: {
            extensions: [".js", ".mjs", ".cjs", ".json"],
            fullySpecified: false
        },
        node: {
            __dirname: false,
            __filename: false
        },
        devtool: false,
        module: {
            rules: [
                {
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
        performance: {
            hints: false
        }
    };

    const commonPlugins = [
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1
        }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^(kerberos|@mongodb-js\/zstd|@aws-sdk\/credential-providers|gcp-metadata|snappy|socks|mongodb-client-encryption|aws4|bson-ext|cardinal|\.d\.ts)$/
        })
    ];

    // Target 1: Standalone Single File (dist/mongodb.js)
    // Toggles minification based on environment (yarn start vs yarn build)
    const distributionConfig = {
        ...baseConfig,
        name: "distribution",
        mode: isProduction ? "production" : "development",
        entry: "./src/index.js",
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: "mongodb.js",
            library: {
                type: "module"
            },
            clean: true,
            globalObject: "this"
        },
        optimization: {
            // The MongoDB driver and bundled CoCreate utilities contain runtime
            // behavior that depends on identifiers remaining intact. Keep the
            // runtime payload equivalent in development and production builds.
            minimize: false,
            concatenateModules: false,
            splitChunks: false,
            runtimeChunk: false
        },
        plugins: [
            ...commonPlugins,
            new FileUploader(env, argv)
        ]
    };

    // Target 2: Self-Extracting Binary Installer (installer/mongodb.installer.js)
    // Dynamic mode & minification based on environment (yarn start vs yarn build)
    const installerConfig = {
        ...baseConfig,
        name: "installer",
        mode: isProduction ? "production" : "development",
        entry: "./src/index.js",
        output: {
            path: path.resolve(__dirname, "installer"),
            filename: "mongodb.installer.js",
            library: {
                type: "module"
            },
            clean: true,
            globalObject: "this"
        },
        optimization: {
            // Keep the embedded database payload identical to the runtime build.
            // SelfCleaningBundlePlugin may still minify the small outer wrapper.
            minimize: false,
            concatenateModules: false,
            splitChunks: false,
            runtimeChunk: false
        },
        plugins: [
            ...commonPlugins,
            new SelfCleaningBundlePlugin({ isProduction })
        ]
    };

    return [distributionConfig, installerConfig];
};
