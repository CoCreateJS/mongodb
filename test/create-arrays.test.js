import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { dotNotationToObject } from '@cocreate/utils';
const source = readFileSync(new URL('../src/object.js', import.meta.url), 'utf8');
const start = source.indexOf('                            if (method === "create")');
const block = source.slice(start, source.indexOf('                            if (data[type][i]._id || method === "create"', start));
const replaceStart = source.indexOf('function replaceArray(');
const replace = source.slice(replaceStart, source.indexOf('export default object;', replaceStart));
function create(object) {
    const data = { object: [object], organization_id: 'platform', timeStamp: new Date().toISOString() };
    vm.runInNewContext(replace + '\n' + block, {data, type:'object', i:0, method:'create', dotNotationToObject});
    return data.object[0];
}
test('create preserves bracket-indexed arrays and sibling fields', () => {
    const result = create({'host[0].name':'test7.cocreatejs.com', 'host[0].database':'tenant', 'host[1].name':'other.example.com', organization_id:'tenant'});
    assert.ok(Array.isArray(result.host));
    assert.deepEqual(result.host, [{name:'test7.cocreatejs.com', database:'tenant'}, {name:'other.example.com'}]);
    assert.equal(result.organization_id, 'tenant');
});
test('create preserves an already nested host array', () => {
    const result = create({host:[{name:'test7.cocreatejs.com'}]});
    assert.ok(Array.isArray(result.host));
    assert.equal(result.host[0].name, 'test7.cocreatejs.com');
    assert.equal(result.organization_id, 'platform');
});
