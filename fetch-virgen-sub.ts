import axios from "axios";

async function main() {
  const apiKey = "acp-8fccbd4e63140922bbc2";
  try {
    const res = await axios.get("https://bounty.virtuals.io/degen-claw/agent", {
      headers: { "x-api-key": apiKey }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error(err.response?.data || err.message);
  }
}
main();
