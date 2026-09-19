const callId = "TEST_CALL_ID";
const callCreator = "TEST_CALL_CREATOR";
const target = "TEST_TARGET";

const node = {
  tag: "call",
  attrs: {
    to: target
  },
  content: [
    {
      tag: "mute_v2",
      attrs: {
        "call-id": callId,
        "call-creator": callCreator,
        "mute-state": "muted"
      }
    }
  ]
};

console.log("=== MUTE_V2 TEST NODE ===");
console.log(JSON.stringify(node, null, 2));
console.log("=========================");
console.log("هیچ Nodeای ارسال نشد؛ این فقط تست ساختار است.");
