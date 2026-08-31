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
    createFilter, 
    createData,
    errorHandler 
} from "./utilities.js";

/**
 * Isolated CRUD Processor for Array/Collection Management.
 * 
 * @param {string} method - Operation targeting database collections (read, create, update, delete)
 * @param {Object} data - Context query details containing database and collection matrices
 */
function array(method, data) {
    const storageName = data.storageConfig?.name;

    return new Promise(
        async (resolve, reject) => {
            let type = "array";
            let arrayArray = [];

            try {
                const client = await dbClient(data);
                if (!client || client.status === false) return resolve(data);

                if (data.request) data.array = data.request;

                let databases = data.database;
                if (!Array.isArray(databases)) databases = [databases];

                for (let database of databases) {
                    const db = client.db(database);

                    if (method == "read") {
                        let { query, sort } = await createFilter(data);

                        try {
                            const result = await db.listCollections().toArray();
                            if (result) {
                                process.emit("usage", {
                                    type: "ingress",
                                    data: result,
                                    organization_id: data.organization_id
                                });

                                for (let res of result) {
                                    if (data.filter && data.filter.query) {
                                        let isFilter = queryData(
                                            res,
                                            data.filter.query
                                        );
                                        if (isFilter)
                                            arrayArray.push({
                                                name: res.name,
                                                database,
                                                storage: storageName
                                            });
                                    } else
                                        arrayArray.push({
                                            name: res.name,
                                            database,
                                            storage: storageName
                                        });
                                }
                            }
                        } catch (error) {
                            errorHandler(data, error, database);
                        }
                    } else {
                        let arrays;
                        let value;
                        if (method == "update")
                            arrays = Object.entries(data.array);
                        else arrays = data.array;

                        if (!Array.isArray(arrays)) arrays = [arrays];

                        for (let array of arrays) {
                            if (method == "create") {
                                process.emit("usage", {
                                    type: "egress",
                                    data: array,
                                    organization_id: data.organization_id
                                });

                                try {
                                    const result = await db.createCollection(array);
                                    if (result) {
                                        process.emit("usage", {
                                            type: "ingress",
                                            data: { status: "created", name: array },
                                            organization_id: data.organization_id
                                        });

                                        arrayArray.push({
                                            name: array,
                                            database,
                                            storage: storageName
                                        });
                                    }
                                } catch (error) {
                                    errorHandler(data, error, database, array);
                                }
                            } else {
                                if (method == "update") {
                                    [array, value] = array;
                                }

                                const arrayObj = db.collection(array);

                                if (method == "update") {
                                    process.emit("usage", {
                                        type: "egress",
                                        data: { rename: value },
                                        organization_id: data.organization_id
                                    });

                                    try {
                                        const result = await arrayObj.rename(value);
                                        if (result) {
                                            process.emit("usage", {
                                                type: "ingress",
                                                data: { status: "renamed", from: array, to: value },
                                                organization_id: data.organization_id
                                            });

                                            arrayArray.push({
                                                name: value,
                                                oldName: array,
                                                database,
                                                storage: storageName
                                            });
                                        }
                                    } catch (error) {
                                        errorHandler(data, error, database, array);
                                    }
                                }

                                if (method == "delete") {
                                    process.emit("usage", {
                                        type: "egress",
                                        data: { drop: array },
                                        organization_id: data.organization_id
                                    });

                                    try {
                                        const result = await arrayObj.drop();
                                        if (result) {
                                            process.emit("usage", {
                                                type: "ingress",
                                                data: { status: "dropped", name: array },
                                                organization_id: data.organization_id
                                            });

                                            arrayArray.push({
                                                name: array,
                                                database,
                                                storage: storageName
                                            });
                                        }
                                    } catch (error) {
                                        errorHandler(data, error, database, array);
                                    }
                                }
                            }
                        }
                    }
                }

                data = createData(
                    data,
                    arrayArray,
                    type
                );
                resolve(data);
            } catch (error) {
                errorHandler(data, error);
                console.log(method, "error", error);
                resolve(data);
            }
        }
    );
}

export default array;