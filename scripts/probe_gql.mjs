import { SuiGraphQLClient } from '@mysten/sui/graphql';

const client = new SuiGraphQLClient({
  url: 'https://sui-mainnet.mystenlabs.com/graphql',
  network: 'mainnet',
});

const result = await client.query({
  query: `
    query {
      object(address: "0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5") {
        asMoveObject {
          contents { json }
        }
      }
    }
  `,
});
console.log(JSON.stringify(result, null, 2));
