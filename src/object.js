import { ObjectId } from "mongodb";
import {
    dotNotationToObject,
    searchData,
    isValidDate
} from "@cocreate/utils";

import { 
    dbClient, 
    createFilter, 
    createData,
    errorHandler 
} from "./utilities.js";

function object(method, data) {
    const storageName = data.storageConfig?.name;
    return new Promise(
        async (resolve, reject) => {
            try {
                const client = await dbClient(data);

                if (!client || client.status === false) return resolve(data);

                let type = "object";
                let documents = [];

                if (!data["timeStamp"])
                    data["timeStamp"] = new Date().toISOString();

                let databases = data.database;
                if (!Array.isArray(databases)) databases = [databases];

                for (let database of databases) {
                    let arrays = data.array;
                    if (!Array.isArray(arrays)) arrays = [arrays];

                    for (let array of arrays) {
                        const db = client.db(database);
                        const arrayObj = db.collection(array);
                        const reference = {
                            $storage: storageName,
                            $database: database,
                            $array: array
                        };

                        if (!data[type]) data[type] = [];
                        else if (typeof data[type] === "string")
                            data[type] = [{ _id: data[type] }];
                        else if (!Array.isArray(data[type]))
                            data[type] = [data[type]];

                        let isFilter;
                        if (data.$filter) isFilter = true;
                        if ((isFilter && !data[type].length) || data.isFilter)
                            data[type].splice(0, 0, {
                                isFilter: "isEmptyObjectFilter"
                            });

                        let filter = await createFilter(data, arrayObj);

                        let projections = {},
                            projection = {},
                            globalUpdate = {},
                            options = {};

                        if (data.$filter && data.$filter.key)
                            projection = data.$filter.key;

                        if (method === "update")
                            createUpdate(globalUpdate, options, data, true);

                        for (let i = 0; i < data[type].length; i++) {
                            let $storage = data[type][i].$storage || [];
                            let $database = data[type][i].$database || [];
                            let $array = data[type][i].$array || [];
                            let update = { ...globalUpdate };

                            if (!Array.isArray($storage))
                                $storage = [data[type][i].$storage];
                            if (!Array.isArray($database))
                                $database = [data[type][i].$database];
                            if (!Array.isArray($array))
                                $array = [data[type][i].$array];

                            if (!$storage.includes(storageName))
                                $storage.push(storageName);
                            if (!$database.includes(database))
                                $database.push(database);
                            if (!$array.includes(array)) $array.push(array);

                            delete data[type][i].$storage;
                            delete data[type][i].$database;
                            delete data[type][i].$array;

                            if (method !== "create" && data[type][i].$filter) {
                                isFilter = true;
                                reference["$filter"] = data[type][i].$filter;
                                filter = await createFilter(
                                    { $filter: data[type][i].$filter },
                                    arrayObj
                                );
                            }

                            let { query, sort, index, limit } = filter;

                            if (method === "create") {
                                if (typeof replaceArray === 'function') {
                                    data[type][i] = replaceArray(data[type][i]);
                                }
                                data[type][i] = dotNotationToObject(
                                    data[type][i]
                                );
                                data[type][i]["organization_id"] =
                                    data["organization_id"];
                                data[type][i]["created"] = {
                                    on: new Date(data.timeStamp),
                                    by: data.user_id || data.clientId
                                };
                            } else if (method === "update") {
                                if (!data[type][i].modified)
                                    data[type][i].modified = {
                                        on: new Date(data.timeStamp),
                                        by: data.user_id || data.clientId
                                    };
                                else
                                    data[type][i].modified.on = new Date(
                                        data[type][i].modified.on
                                    );

                                data[type][i].organization_id =
                                    data.organization_id;
                                createUpdate(update, options, data[type][i]);
                            }

                            if (data[type][i]._id || method === "create" || isFilter) {
                                if (method !== "create") {
                                    try {
                                        if (data[type][i]._id) {
                                            query._id = new ObjectId(data[type][i]._id);
                                        }
                                    } catch (error) {
                                        if (
                                            method === "update" &&
                                            options.upsert
                                        ) {
                                            data[type][i]._id = new ObjectId();
                                            query._id = data[type][i]._id;
                                        } else {
                                            errorHandler(
                                                data,
                                                error,
                                                database,
                                                array
                                            );
                                            continue;
                                        }
                                    }
                                }

                                try {
                                    process.emit("usage", {
                                        type: "egress",
                                        data: { query, update, projection, options },
                                        organization_id: data.organization_id
                                    });

                                    let result;
                                    if (method === "create") {
                                        if (data[type][i]._id) {
                                            try {
                                                data[type][i]._id = new ObjectId(
                                                    data[type][i]._id
                                                );
                                            } catch (error) {
                                                delete data[type][i]._id;
                                            }
                                        }
                                        result = await arrayObj.insertOne(
                                            data[type][i]
                                        );
                                        data[type][i]._id =
                                            result.insertedId.toString();
                                        
                                        let createDoc = { ...data[type][i], ...reference };
                                        delete createDoc.isFilter;
                                        documents.push(createDoc);
                                    } else {
                                        let cursor = arrayObj.find(query, { projection });
                                        if (sort && Object.keys(sort).length > 0) cursor = cursor.sort(sort);
                                        if (limit) cursor = cursor.limit(limit);

                                        let hasDocuments = false;

                                        for await (const document of cursor) {
                                            hasDocuments = true;
                                            
                                            process.emit("usage", {
                                                type: "ingress",
                                                data: document,
                                                organization_id: data.organization_id
                                            });

                                            if (data.$filter && data.$filter.search) {
                                                let isMatch = searchData(
                                                    document,
                                                    data.$filter.search
                                                );
                                                if (!isMatch) continue;
                                            }

                                            if (method === "read") {
                                                document._id = document._id.toString();
                                                let object = data[type].find(
                                                    (obj) =>
                                                        obj._id &&
                                                        obj._id.toString() === document._id.toString()
                                                );

                                                if (object && object.$storage && object.modified && object.modified.on) {
                                                    if (document.modified && new Date(object.modified.on) > new Date(document.modified.on)) {
                                                        object = { ...document, ...object };
                                                        let docUpdate = {};
                                                        let docOptions = {};
                                                        createUpdate(docUpdate, docOptions, object);
                                                        let updateResult = await arrayObj.updateOne(
                                                            { _id: new ObjectId(document._id) },
                                                            docUpdate,
                                                            docOptions
                                                        );
                                                        
                                                        process.emit("usage", {
                                                            type: "ingress",
                                                            data: updateResult,
                                                            organization_id: data.organization_id
                                                        });
                                                    }
                                                }
                                                
                                                let readDoc = { ...document, ...reference };
                                                delete readDoc.isFilter;
                                                documents.push(readDoc);
                                            } else {
                                                process.emit("usage", {
                                                    type: "egress",
                                                    data: { _id: document._id, update, options },
                                                    organization_id: data.organization_id
                                                });

                                                if (method === "update") {
                                                    if (update["$pull"] && update["$unset"]) {
                                                        result = await arrayObj.updateOne(
                                                            { _id: document._id },
                                                            { $unset: update["$unset"] },
                                                            options
                                                        );
                                                        delete update["$unset"];
                                                    }

                                                    if (options.returnNewDocument) {
                                                        let updatedObj = await arrayObj.findOneAndUpdate(
                                                            { _id: document._id },
                                                            update,
                                                            { ...options, returnDocument: 'after' }
                                                        );

                                                        // Handle standard modern Driver v6+ directly while maintaining safety
                                                        let updatedDoc = (updatedObj && updatedObj.value) ? updatedObj.value : updatedObj;

                                                        if (updatedDoc) {
                                                            for (let key of Object.keys(updatedDoc)) {
                                                                if (key === "_id" || !options.newArray) continue;
                                                                let newArrayKey = options.newArray[key];
                                                                if (newArrayKey) {
                                                                    let idx = updatedDoc[key].length - 1;
                                                                    if (idx >= 0) {
                                                                        data[type][i][newArrayKey.replace("[]", `[${idx}]`)] = data[type][i][newArrayKey];
                                                                    }
                                                                }
                                                            }
                                                            data[type][i] = { ...updatedDoc, ...data[type][i] };
                                                        }
                                                    } else {
                                                        result = await arrayObj.updateOne(
                                                            { _id: document._id },
                                                            update,
                                                            options
                                                        );
                                                    }
                                                } else if (method === "delete") {
                                                    result = await arrayObj.deleteOne({
                                                        _id: document._id
                                                    });
                                                }

                                                process.emit("usage", {
                                                    type: "ingress",
                                                    data: result,
                                                    organization_id: data.organization_id
                                                });

                                                let docToPush = {
                                                    ...document,
                                                    ...data[type][i],
                                                    ...reference,
                                                    _id: document._id.toString()
                                                };
                                                delete docToPush.isFilter;
                                                documents.push(docToPush);
                                            }
                                        }

                                        if (!hasDocuments && method === "update" && (data.upsert || options.upsert)) {
                                            let upsertId = data[type][i]._id ? new ObjectId(data[type][i]._id) : new ObjectId();
                                            let result = await arrayObj.updateOne(
                                                { _id: upsertId },
                                                update,
                                                { ...options, upsert: true }
                                            );
                                            
                                            process.emit("usage", {
                                                type: "ingress",
                                                data: result,
                                                organization_id: data.organization_id
                                            });

                                            let upsertDoc = {
                                                ...data[type][i],
                                                ...reference,
                                                _id: upsertId.toString()
                                            };
                                            delete upsertDoc.isFilter;
                                            documents.push(upsertDoc);
                                        }
                                    }
                                } catch (error) {
                                    errorHandler(data, error, database, array);
                                }
                            }
                        }
                    }
                }
                
                data = createData(
                    data,
                    documents,
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

function createUpdate(update, options, data, isGlobal) {
    if (data.upsert) options.upsert = data.upsert;
    if (data.$upsert) options.upsert = data.$upsert;
    if (data.$update) delete data.$update;

    Object.keys(data).forEach((key) => {
        if ((isGlobal && !key.startsWith("$")) || key === "_id") return;

        if (isValidDate(data[key])) data[key] = new Date(data[key]);

        let operator;
        let index;
        let arrayKey;

        if (key.endsWith("]")) {
            const regex = /^(.*(?:\[\d+\].*?)?)\[(.*?)\](?:\[\])?$/;
            var match = key.match(regex);
            if (match) {
                index = parseInt(match[2], 10);
                if (Number.isNaN(index)) operator = match[2];
                arrayKey = match[1].replace(/\[(\d+)\]/g, ".$1");
            }
        }

        if (key.startsWith("$")) operator = key.split(".")[0];
        else if (
            !operator &&
            typeof data[key] === "string" &&
            data[key].startsWith("$")
        )
            operator = data[key];

        if (!update["$set"]) update["$set"] = {};

        let originalKey = key;
        key = key.replace(/\[(\d+)\]/g, ".$1");

        if (originalKey.endsWith("[]")) {
            if (!options.projection) {
                options.projection = {};
                options.arrayKey = {};
                options.returnNewDocument = true;
            } else {
                options.projection[key.replace(operator + ".", "")] = 1;
                options.arrayKey[key.replace(operator + ".", "")] = originalKey;
            }
            if (!key.startsWith("$")) operator = "$push";
            if (key.endsWith("[]")) key = key.replace("[]", "");
        }

        let operators = [
            "$rename",
            "$inc",
            "$push",
            "$each",
            "$splice",
            "$unset",
            "$delete",
            "$slice",
            "$pop",
            "$shift",
            "$addToSet",
            "$pull",
            "$currentDate"
        ];
        if (!operators.includes(operator) && typeof index !== "number") {
            if (!isGlobal) update["$set"][key] = data[originalKey];
            return;
        }

        let updates = {};
        if (operator === "$rename") {
            if (key === "$rename")
                for (let oldkey of Object.keys(data[originalKey])) {
                    key = "$rename." + oldkey;
                    updates[key] = data[originalKey][oldkey].replace(
                        /\[(\d+)\]/g,
                        ".$1"
                    );
                }
            else updates[key] = data[originalKey].replace(/\[(\d+)\]/g, ".$1");
        } else if (
            operator === "$delete" ||
            operator === "$unset" ||
            operator === "$slice"
        ) {
            operator = "$unset";
            updates[key] = 1;
            const pullkey = key.split(".");
            pullkey.shift();
            pullkey.pop();
            if (!update["$pull"]) update["$pull"] = {};
            update["$pull"][pullkey.join(".")] = null;
        } else if (operator === "$pop") {
            key = arrayKey;
            updates[key] = index || 1;
        } else if (operator === "$addToSet" || operator === "$pull") {
            updates[key] = data[originalKey];
        } else if (
            operator === "$push" ||
            operator === "$each" ||
            typeof index === "number"
        ) {
            updates[key] = data[originalKey];
            if (typeof index === "number" && index >= 0) {
                if (!operator) operator = "$set";
                else {
                    if (operator === "$push")
                        updates[key] = [data[originalKey]];

                    let insert = { $each: updates[key] };
                    insert.$postion = index;
                    if (index >= 0) updates[arrayKey] = insert;
                    else updates[key] = insert;
                }
            }
        } else if (operator === "$inc") {
            updates[key] = data[originalKey];
        } else if (operator === "$currentDate") {
            updates[key] = data[originalKey];
        }

        if (!update[operator]) update[operator] = {};

        if (key === operator)
            update[operator] = {
                ...update[operator],
                ...replaceArray(updates[key])
            };
        else update[operator][key.replace(operator + ".", "")] = updates[key];
    });
}

function createProjection(projection, data) {
    Object.keys(data).forEach((key) => {
        if (
            !["_id", "organization_id", "isFIlter"].includes(key) &&
            !key.startsWith("$")
        )
            projection[key.replace(/\[(\d+)\]/g, ".$1")] = 1;
    });

    return projection;
}

function replaceArray(data = {}) {
    let object = {};

    Object.keys(data).forEach((key) => {
        object[key.replace(/\[(\d+)\]/g, ".$1")] = data[key];
    });

    return object;
}

export default object;