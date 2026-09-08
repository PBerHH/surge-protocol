import { SuiGrpcClient } from '@mysten/sui/grpc';
const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });

console.log('--- readMask {paths} ---');
try { const v = await client.getObject({ objectId: VAULT, readMask: { paths: ['json'] } }); console.log(Object.keys(v.object)); } catch (e) { console.log('error:', e.message); }

console.log('--- read_mask snake_case ---');
try { const v = await client.getObject({ objectId: VAULT, read_mask: { paths: ['json'] } }); console.log(Object.keys(v.object)); } catch (e) { console.log('error:', e.message); }

console.log('--- readMask with $typeName ---');
try { const v = await client.getObject({ objectId: VAULT, readMask: { $typeName: 'google.protobuf.FieldMask', paths: ['json'] } }); console.log(Object.keys(v.object)); } catch (e) { console.log('error:', e.message); }

console.log('--- no readMask (default) ---');
try { const v = await client.getObject({ objectId: VAULT }); console.log(Object.keys(v.object)); } catch (e) { console.log('error:', e.message); }
