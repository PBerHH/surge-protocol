import express from "express";
import https from "https";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/graphql", (req, res) => {
  const body = JSON.stringify(req.body);
  const options = {
    hostname: "graphql.mainnet.sui.io", family: 4, servername: "graphql.mainnet.sui.io",
    path: "/graphql",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  };
  const r = https.request(options, (upstream) => {
    let data = "";
    upstream.on("data", chunk => data += chunk);
    upstream.on("end", () => {
      try { res.json(JSON.parse(data)); }
      catch { res.status(500).json({ errors: [{ message: "Parse error" }] }); }
    });
  });
  r.on("error", e => res.status(500).json({ errors: [{ message: e.message }] }));
  r.write(body);
  r.end();
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.listen(8080, () => console.log("Proxy on 8080"));
