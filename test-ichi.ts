import axios from "axios";
async function run() {
  const HL_INFO = "https://api.hyperliquid.xyz/info";
  for (const user of ["0xe9b8304b59bf2f8e076718e41bb913d16dac0a04"]) {
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
