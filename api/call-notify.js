const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();
const messaging = getMessaging();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { calleePhone, callId, callerName, callerPhone, channelName, type } = req.body;

    if (!calleePhone || !callId || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const userDoc = await db.collection("users").doc(String(calleePhone)).get();
    if (!userDoc.exists || !userDoc.data().fcmToken) {
      return res.status(404).json({ error: "Callee or FCM token not found" });
    }

    const message = {
      token: userDoc.data().fcmToken,
      data: {
        type: String(type),
        callId: String(callId),
        callerName: String(callerName || "Unknown"),
        callerPhone: String(callerPhone || ""),
        channelName: String(channelName || callId),
      },
      android: {
        priority: "high",
        ttl: 30000,
      },
    };

    const response = await messaging.send(message);
    return res.status(200).json({ success: true, messageId: response });
  } catch (error) {
    console.error("FCM Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
