import axios from "axios";
async function run() {
  const HL_INFO = "https://api.hyperliquid.xyz/info";
  for (const user of ["0xbf8e97ddf1d411c3a5c415bd5c219d86f31ad4d3"]) {
    try {
      const { data } = await axios.post(HL_INFO, { type: "clearinghouseState", user });
      const val = data?.crossMarginSummary?.accountValue || "0";
      console.log(user, "Value:", val);
    } catch(e: any) {
      console.error(user, e.message);
    }
  }
}
run();
