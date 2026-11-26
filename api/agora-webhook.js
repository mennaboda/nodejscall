const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();

module.exports = async (req, res) => {
  // للتحقق السريع من المتصفح أو من Agora Health Check
  if (req.method === "GET") {
    return res.status(200).json({ status: "Agora Webhook Ready" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { eventType, payload } = req.body || {};

    // Event 102 = channel_destroy (جميع الأطراف خرجوا أو فصل عنهم الإنترنت)
    if (eventType === 102 && payload && payload.channelName) {
      const channelName = String(payload.channelName);
      console.log(`🛑 Agora channel_destroy received for channel: ${channelName}`);

      // البحث عن المكالمة في Firestore باستخدام channelName
      const snapshot = await db
        .collection("calls")
        .where("channelName", "==", channelName)
        .get();

      const updates = [];

      snapshot.forEach((doc) => {
        const currentStatus = doc.data().status;
        if (currentStatus === "RINGING" || currentStatus === "ACCEPTED") {
          updates.push(
            doc.ref.update({
              status: "ENDED",
              endedBy: "AGORA_SERVER_WEBHOOK",
              endedAt: Date.now(),
            })
          );
          console.log(`✅ Auto-ended stuck call in Firestore: calls/${doc.id}`);
        }
      });

      // فحص إضافي لو كان الـ callId هو نفسه الـ channelName
      if (snapshot.empty) {
        const directDoc = await db.collection("calls").doc(channelName).get();
        if (directDoc.exists) {
          const currentStatus = directDoc.data().status;
          if (currentStatus === "RINGING" || currentStatus === "ACCEPTED") {
            updates.push(
              directDoc.ref.update({
                status: "ENDED",
                endedBy: "AGORA_SERVER_WEBHOOK",
                endedAt: Date.now(),
              })
            );
            console.log(`✅ Auto-ended stuck call (direct ID): calls/${channelName}`);
          }
        }
      }

      await Promise.all(updates);
    }

    // لازم نرجع 200 OK دايماً عشان Agora تتأكد إن الإشارة وصلت بنجاح
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Agora Webhook Error:", error);
    return res.status(200).json({ received: true, error: error.message });
  }
};
