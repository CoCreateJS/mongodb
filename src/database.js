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

import { queryData } from "@cocreate/utils";
import { 
    dbClient, 
    createData, 
    errorHandler 
} from "./utilities.js";

/**
 * Isolated CRUD Processor for Database Management.
 *
 * @param {string} method - Operation targeting database layers (read, delete)
 * @param {Object} data - Context query details and transactional metrics
 * @private
 * @environment server
 */
function database(method, data) {
    const storageName = data.storageConfig?.name;
    return new Promise(
        async (resolve, reject) => {
            let type = "database";
            let databaseArray = [];

            try {
                const client = await dbClient(data);
                if (!client || client.status === false) return resolve(data);
                
                if (method == "read") {
                    const db = client.db().admin();

                    // List all the available databases
                    try {
                        const dbs = await db.listDatabases();

                        // Emit ingress telemetry with raw list databases payload
                        process.emit("usage", {
                            type: "ingress",
                            data: dbs,
                            organization_id: data.organization_id
                        });

                        for (let database of dbs.databases) {
                            if (data.filter && data.filter.query) {
                                let isFilter = queryData(
                                    database,
                                    data.filter.query
                                );
                                if (isFilter)
                                    databaseArray.push({
                                        database,
                                        storage: storageName
                                    });
                            } else
                                databaseArray.push({
                                    database,
                                    storage: storageName
                                });
                        }

                        resolve(createData(data, databaseArray, type));
                    } catch (error) {
                        errorHandler(data, error);
                        resolve(data);
                    }
                }
                
                if (method == "delete") {
                    const db = client.db(data.database);
                    try {
                        const result = await db.dropDatabase();

                        // Emit ingress telemetry with raw deletion success payload
                        process.emit("usage", {
                            type: "ingress",
                            data: result,
                            organization_id: data.organization_id
                        });

                        resolve(result);
                    } catch(error) {
                        errorHandler(data, error);
                        resolve(data);
                    }
                }
            } catch (error) {
                errorHandler(data, error);
                console.log(method, "error", error);
                resolve(data);
            }
        },
        (error) => {
            errorHandler(data, error);
        }
    );
}

export default database;
