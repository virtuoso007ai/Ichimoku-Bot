import axios from "axios";

async function main() {
  const apiKey = "dgc_7ff13d35ef9d0b8a9a59fdb8a9183db3b0feb63334db2d3b";
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
