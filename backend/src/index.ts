import express from "express";
import cors from "cors";
import { router } from "./routes.js";
import { config } from "./config.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", router);

app.listen(config.port, () => {
  console.log(`PrivatePay backend listening on http://localhost:${config.port}`);
});
