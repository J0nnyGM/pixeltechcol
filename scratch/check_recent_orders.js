const admin = require("./functions/node_modules/firebase-admin");
const serviceAccount = require("./functions/serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

async function check() {
  const snapshot = await db.collection("orders")
    .where("internalOrderNumber", ">=", 3562)
    .where("internalOrderNumber", "<=", 3575)
    .get();

  console.log(`Found ${snapshot.size} orders`);
  const orders = [];
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    orders.push({
      id: doc.id,
      internalOrderNumber: data.internalOrderNumber,
      customer: data.customer?.name,
      mlOrderId: data.mlOrderId || data.marketplaceOrderId || data.orderId,
      shippingId: data.shippingId || data.shipping?.id,
      dateCreated: data.dateCreated,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
      items: data.items?.map(i => ({ title: i.title, quantity: i.quantity, sku: i.sku })),
      status: data.status,
      shippingStatus: data.shippingStatus,
      rawBuyer: data.rawBuyer || data.buyer
    });
  });

  // Sort by internalOrderNumber
  orders.sort((a, b) => a.internalOrderNumber - b.internalOrderNumber);
  console.log(JSON.stringify(orders, null, 2));
}

check().catch(console.error);
