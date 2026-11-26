const http = require("http");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

// قراءة المفتاح بأمان من Render Environment Variable (أو من الملف لو شغال محلياً)
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require("./serviceAccountKey.json");

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();
const messaging = getMessaging();

// 1. سيرفر HTTP بسيط عشان Render يتأكد إن التطبيق شغال (Health Check)
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Call Notification Server is Alive!");
  })
  .listen(PORT, () => {
    console.log(`🌐 HTTP Server listening on port ${PORT}`);
  });

// 2. مراقبة المكالمات في Firestore
console.log("🚀 Listening to Firestore calls...");
let isInitialLoad = true;

db.collection("calls").onSnapshot(
  (snapshot) => {
    if (isInitialLoad) {
      isInitialLoad = false;
      console.log(`✅ Connected! Ignored ${snapshot.size} old calls.`);
      return;
    }

    snapshot.docChanges().forEach(async (change) => {
      const callId = change.doc.id;
      const callData = change.doc.data();
      const status = callData.status;

      console.log(`📞 Call [${change.type}] -> ID: ${callId}, Status: ${status}`);

      if (change.type === "added" && status === "RINGING") {
        await sendCallNotification(callId, callData, "INCOMING_CALL");
      }

      if (change.type === "modified" && (status === "ENDED" || status === "MISSED")) {
        await sendCallNotification(callId, callData, "CALL_CANCELLED");
      }
    });
  },
  (error) => {
    console.error("❌ Firestore Listener Error:", error);
  }
);

async function sendCallNotification(callId, callData, type) {
  try {
    const calleePhone = callData.calleePhone;
    if (!calleePhone) return;

    const userDoc = await db.collection("users").doc(String(calleePhone)).get();
    if (!userDoc.exists) return;

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) return;

    const message = {
      token: fcmToken,
      data: {
        type: String(type),
        callId: String(callId),
        callerName: String(callData.callerName || "Unknown"),
        callerPhone: String(callData.callerPhone || ""),
        channelName: String(callData.channelName || callId),
      },
      android: {
        priority: "high",
        ttl: 30000,
      },
    };

    const response = await messaging.send(message);
    console.log(`✅ Sent [${type}] to ${calleePhone}! MsgID: ${response}`);
  } catch (err) {
    console.error("❌ Error sending FCM:", err);
  }
}