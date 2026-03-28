import { closePosition } from "./scripts/degen/trade-executor.js";

async function main() {
  console.log("Attempting close...");
  try {
    const id = await closePosition({
      pair: "HYPE",
      side: "short",
      size: 1, // dummy
      leverage: 5
    });
    console.log("SUCCESS, ID:", id);
  } catch (e: any) {
    if (e.response) {
      console.log("ERROR RESPONSE:", e.response.status, e.response.data);
    } else {
      console.log("ERROR:", e.message);
    }
  }
}

main();
