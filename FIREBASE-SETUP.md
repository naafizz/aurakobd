# AURAKO — Firebase Setup (Free "Spark" Plan)

Cash on Delivery checkout is wired to Firebase Firestore in `checkout.html`
(and order lookup in `track-order.html`). Out of the box, with no setup,
orders are saved to the browser's `localStorage` instead, so the whole
site — including checkout and order tracking — works immediately after
you upload it, with zero configuration.

To connect real Firestore storage so orders show up in the Firebase
Console (and are visible across devices/admins), follow these steps:

## 1. Create a Firebase project
1. Go to https://console.firebase.google.com and click **Add project**.
2. Name it (e.g. `aurako-shop`) and finish the wizard. The default
   **Spark (free)** plan is enough — no billing required.

## 2. Create a Firestore database
1. In the left sidebar, open **Build → Firestore Database**.
2. Click **Create database**, choose **Start in production mode** (or
   test mode while developing), and pick a region close to your
   customers.

## 3. Register a Web App
1. In **Project settings → General → Your apps**, click the **Web**
   icon (`</>`).
2. Give it a nickname and click **Register app**.
3. Firebase will show a `firebaseConfig` object like:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "aurako-shop.firebaseapp.com",
  projectId: "aurako-shop",
  storageBucket: "aurako-shop.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
```

## 4. Paste your config into the site
Open these two files and replace the placeholder `firebaseConfig`
object near the top of the `<script>` block with your real values:

- `checkout.html` — saves each new order to the `orders` collection
- `track-order.html` — looks up an order by ID for tracking

Both files fall back to `localStorage` automatically if the config is
still set to the placeholder values, so you can deploy safely at any
stage.

## 5. Firestore Security Rules (recommended)
By default, "production mode" blocks all reads/writes. Since this is a
storefront where customers place COD orders directly from the browser
(no backend), use rules that allow creating and reading orders by ID,
but not listing or editing them:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /orders/{orderId} {
      allow create: if true;
      allow get: if true;
      allow update, delete, list: if false;
    }
  }
}
```

Paste this into **Firestore Database → Rules** and click **Publish**.

## 6. Viewing orders as an admin
Open **Firestore Database → Data** in the Firebase Console — every
order placed through checkout will appear as a document in the
`orders` collection, with the Order ID as the document ID, containing
the customer's contact/delivery details, line items, totals, and
status (`Processing` by default — update this field manually in the
console to move an order through `Confirmed → Out for Delivery →
Delivered`, which `track-order.html` will reflect).

## 7. Free plan limits
The Spark plan includes (at time of writing) 50,000 document reads,
20,000 writes, and 20,000 deletes per day, and 1GiB of storage — more
than enough for a small-to-medium storefront. Monitor usage under
**Usage and billing** in the console.
