import { SuiGrpcClient } from '@mysten/sui/grpc';
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
console.log("client.core:", client.core ? Object.getOwnPropertyNames(Object.getPrototypeOf(client.core)) : "kein .core");
