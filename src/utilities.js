/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 ********************************************************************************/

import { MongoClient, ObjectId } from "mongodb";

const organizations = {};

/**
 * Dynamically resolves or caches a long-lived MongoDB Client instance using modern driver syntax.
 * @param {Object} data - Context parameters containing credentials and storage URL
 * @returns {Promise<MongoClient>} Resolved MongoDB Client connection
 */
async function dbClient(data) {
    const storageUrl = data.storageConfig?.url
    if (storageUrl) {
        if (!organizations[data.organization_id]) {
            organizations[data.organization_id] = {};
        }
        
        try {
            // If connection doesn't exist, create it and store the promise to prevent concurrent duplicate connections
            if (!organizations[data.organization_id][storageUrl]) {
                // Native MongoDB Node.js Driver v6+ recommended constructor instantiation
                const client = new MongoClient(storageUrl, {
                    maxPoolSize: 100,
                    minPoolSize: 0,             // Connections scale all the way down to 0 when idle
                    maxIdleTimeMS: 30000,       // Automatically disconnects individual sockets after 30 seconds of inactivity
                    connectTimeoutMS: 5000,
                    socketTimeoutMS: 30000
                });

                // Cache the connection promise so simultaneous requests share the same initialization lifecycle
                organizations[data.organization_id][storageUrl] = client.connect();
            }

            // Await connection resolution safely
            organizations[data.organization_id][storageUrl] = await organizations[data.organization_id][storageUrl];
            return organizations[data.organization_id][storageUrl];
        } catch (error) {
            console.error(
                `${data.organization_id}: storageUrl ${storageUrl} failed to connect to mongodb`
            );
            errorHandler(data, error);
            return { status: false };
        }
    }

    errorHandler(data, "missing StorageUrl");
    return;
}

/**
 * Global Event Listener: orgDeleted
 * Triggers clean teardowns of cached database connection pools as users disconnect.
 * 
 * DESIGN DECISION: Cooperative Connection Drain
 * Instead of closing active client connections instantly, we register a 5-second 
 * delay timeout. This allows other events and modules (such as CoCreateUsage, telemetry,
 * and system caches) to execute final asynchronous transactions and flush outstanding logs
 * safely before the underlying sockets are severed.
 */
process.on('orgDeleted', (organization_id) => {
    const orgPools = organizations[organization_id];
    
    if (orgPools) {
        console.log(`[DB Utilities] Cleanup Scheduled: Initiating 5-second grace period for Org: ${organization_id}`);
        
        setTimeout(async () => {
            // Re-verify that the connection pool reference wasn't already deleted or modified
            const currentPools = organizations[organization_id];
            if (!currentPools) return;

            console.log(`[DB Utilities] Cleanup Executing: Closing connection pools for inactive Org: ${organization_id}`);
            
            // Extract connection clients directly using Object.values
            const clientsList = Object.values(currentPools);
            
            for (const client of clientsList) {
                try {
                    if (client && typeof client.close === 'function') {
                        // Close socket pools gracefully to free db sockets
                        await client.close();
                    }
                } catch (err) {
                    console.error(`[DB Utilities] Error closing connection for Org ${organization_id}:`, err);
                }
            }
            
            // Remove reference to enable complete garbage collection (V8 memory release)
            delete organizations[organization_id];
            console.log(`[DB Utilities] Memory Cleared: Reference for Org ${organization_id} removed from runtime registry.`);
        }, 5000); // 5-second grace interval
    }
});

async function createFilter(data, arrayObj) {
    let query = {},
        sort = {},
        index = 0,
        limit = 0,
        count;

    if (data.$filter) {
        function convertIfDate(value) {
            if (
                typeof value === "string" &&
                value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
            ) {
                return new Date(value);
            }
            return value;
        }

        // Recursive function to merge keys into dot notation
        function mergeToDotNotation(obj, parentKey = "", result = {}) {
            for (let key in obj) {
                const isOperator = key.startsWith("$");
                const currentKey = parentKey ? `${parentKey}.${key}` : key;

                if (
                    obj[key] &&
                    typeof obj[key] === "object" &&
                    !Array.isArray(obj[key])
                ) {
                    if (isOperator) {
                        // Ensure operators are grouped under their parent key
                        result[parentKey] = result[parentKey] || {};
                        result[parentKey][key] = obj[key];
                    } else {
                        // Recurse into nested objects
                        mergeToDotNotation(obj[key], currentKey, result);
                    }
                } else {
                    // Assign to result, merging into dot notation if applicable
                    if (isOperator) {
                        result[parentKey] = result[parentKey] || {};
                        result[parentKey][key] = obj[key];
                    } else {
                        result[currentKey] = obj[key];
                    }
                }
            }
            return result;
        }

        if (data.$filter.query) {
            for (let key in data.$filter.query) {
                if (Array.isArray(data.$filter.query[key])) {
                    // Handle $or operator with an array of conditions
                    query[key] = data.$filter.query[key].map((condition) => {
                        let newCondition = {};
                        mergeToDotNotation(condition, "", newCondition);
                        return newCondition;
                    });
                } else if (
                    typeof data.$filter.query[key] === "object" &&
                    data.$filter.query[key] !== null
                ) {
                    // Handle general object conditions
                    mergeToDotNotation(data.$filter.query[key], key, query);
                } else {
                    // Handle direct values
                    query[key] =
                        key === "_id"
                            ? new ObjectId(data.$filter.query[key])
                            : convertIfDate(data.$filter.query[key]);
                }
            }
        }

        if (data.$filter.sort) {
            for (let i = 0; i < data.$filter.sort.length; i++) {
                let direction = data.$filter.sort[i].direction;
                direction = direction === "desc" || direction === -1 ? -1 : 1;

                sort[data.$filter.sort[i].key] = direction;
            }
        }

        if (arrayObj) {
            count = await arrayObj.estimatedDocumentCount();
            data.$filter.count = count;
        }

        if (data.$filter.index) index = data.$filter.index;
        if (data.$filter.limit) limit = data.$filter.limit;
    }

    if (data["organization_id"])
        query["organization_id"] = data["organization_id"];

    return { query, sort, index, limit, count };
}

function parseRegExp(regExpString) {
    let matches = regExpString.match(/\/(.*)\/(.*)/);
    return {
        pattern: matches[1],
        options: matches[2]
    };
}

function createData(data, array, type) {
    if (
        data[type] &&
        data[type][0] &&
        data[type][0].isFilter === "isEmptyObjectFilter"
    ) {
        data[type].shift();
        data.isFilter = true;
    }

    let key = "_id";
    if (type !== "object") key = "name";

    // handle case where data[type] is not an array
    if (!Array.isArray(data[type]))
        console.log("data[type] is not an array", type);
    else {
        for (let i = 0; i < array.length; i++) {
            const matchIndex = data[type].findIndex(
                (item) => item[key] === array[i][key]
            );
            if (matchIndex !== -1) {
                for (let $type of ["$storage", "$database", "$array"]) {
                    if (!data[type][matchIndex][$type])
                        data[type][matchIndex][$type] = [];
                    if (!Array.isArray(data[type][matchIndex][$type])) {
                        data[type][matchIndex][$type] = [
                            data[type][matchIndex][$type]
                        ];
                        if (
                            !data[type][matchIndex][$type].includes(
                                array[i][$type]
                            )
                        ) {
                            data[type][matchIndex][$type].push(array[i][$type]);
                        }
                    } else {
                        data[type][matchIndex][$type].push(array[i][$type]);
                    }
                    delete array[i][$type];
                }

                // compare dates and merge and updates to keep all synced and up to date
                data[type][matchIndex] = {
                    ...data[type][matchIndex],
                    ...array[i]
                };
            } else data[type].push(array[i]);
        }
    }

    return data;
}

function errorHandler(data, error, database, array) {
    let errorMessage =
        typeof error === "object" && error.message ? error.message : error;

    let errorObject = {
        message: errorMessage,
        storage: "mongodb"
    };

    if (database) errorObject.database = database;
    if (array) errorObject.array = array;

    if (Array.isArray(data.error)) {
        data.error.push(errorObject);
    } else {
        data.error = [errorObject];
    }
}

export {
    dbClient,
    createFilter,
    parseRegExp,
    createData,
    errorHandler
};