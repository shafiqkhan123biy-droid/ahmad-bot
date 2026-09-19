const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const qrcode = require("qrcode-terminal");

const SESSION = "./session";
const BOT_NAME = "احمد بلال";

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 QR احمد بلال:\n");
      qrcode.generate(qr, { small: true });
      console.log(
        "\nWhatsApp → Settings → Linked Devices → Link a Device\n"
      );
    }

    if (connection === "connecting") {
      console.log("🔄 در حال اتصال به واتساپ...");
    }

    if (connection === "open") {
      console.log(`
================================
✅ ${BOT_NAME} وصل شد!
🤖 ربات فعال است
================================
`);
    }

    if (connection === "close") {
      const code =
        lastDisconnect?.error?.output?.statusCode;

      console.log("❌ اتصال بسته شد:", code);

      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 اتصال دوباره بعد از 3 ثانیه...");

        setTimeout(() => {
          startBot().catch((err) => {
            console.log("❌ Restart Error:", err.message);
          });
        }, 3000);
      } else {
        console.log("⚠️ حساب از واتساپ خارج شده است.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg || !msg.message) return;
      if (msg.key.fromMe) return;

      const jid = msg.key.remoteJid;

      if (!jid) return;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      const command = text.trim().toLowerCase();

      if (!command) return;

      /* ================= PING ================= */

      if (command === "/ping" || command === "ping") {
        await sock.sendMessage(jid, {
          text:
`🏓 PONG!

🤖 ${BOT_NAME}
✅ وضعیت: فعال
⚡ سرعت: عالی`
        });
        return;
      }

      /* ================= MENU ================= */

      if (command === "/menu" || command === "menu") {
        await sock.sendMessage(jid, {
          text:
`╭━━━〔 🤖 ${BOT_NAME} 〕━━━╮

🏓 /ping
📋 /menu
❓ /help
📜 /rules
ℹ️ /info

👮 /admins
📢 /tagall
🙈 /hidetag

👋 سلام
🤖 احمد بلال

╰━━━━━━━━━━━━━━━━━━╯`
        });
        return;
      }

      /* ================= HELP ================= */

      if (command === "/help" || command === "help") {
        await sock.sendMessage(jid, {
          text:
`🤖 راهنمای ${BOT_NAME}

🏓 /ping
بررسی فعال بودن ربات

📋 /menu
نمایش منوی ربات

📜 /rules
نمایش قوانین

ℹ️ /info
اطلاعات ربات

👮 /admins
نمایش مدیران گروه

📢 /tagall
منشن تمام اعضای گروه

🙈 /hidetag
منشن مخفی اعضای گروه`
        });
        return;
      }

      /* ================= RULES ================= */

      if (command === "/rules" || command === "rules") {
        await sock.sendMessage(jid, {
          text:
`📜 قوانین گروه

1️⃣ احترام به همه اعضا
2️⃣ عدم ارسال پیام‌های مزاحم
3️⃣ عدم ارسال لینک ناخواسته
4️⃣ رعایت قوانین واتساپ
5️⃣ احترام به مدیران گروه

🤖 ${BOT_NAME}`
        });
        return;
      }

      /* ================= INFO ================= */

      if (command === "/info" || command === "info") {
        await sock.sendMessage(jid, {
          text:
`╭━━〔 ℹ️ اطلاعات ربات 〕━━╮

🤖 نام: ${BOT_NAME}
📱 پلتفرم: WhatsApp
🔧 موتور: Baileys
⚡ وضعیت: آنلاین

╰━━━━━━━━━━━━━━━━━━╯`
        });
        return;
      }

      /* ================= GREETING ================= */

      const greetings = [
        "سلام",
        "سلام 👋",
        "سلام علیکم",
        "السلام علیکم",
        "صبح بخیر",
        "شب بخیر"
      ];

      if (greetings.includes(command)) {
        await sock.sendMessage(jid, {
          text:
`👋 سلام!

🌹 خوش آمدی

🤖 ${BOT_NAME} در خدمت شماست.

برای دیدن امکانات:
 /menu`
        });
        return;
      }

      /* ================= TAG ALL ================= */

      if (command === "/tagall" || command === "tagall") {

        if (!jid.endsWith("@g.us")) {
          await sock.sendMessage(jid, {
            text: "❌ این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const metadata =
          await sock.groupMetadata(jid);

        const participants =
          metadata.participants || [];

        if (!participants.length) {
          await sock.sendMessage(jid, {
            text: "❌ اعضای گروه پیدا نشدند."
          });
          return;
        }

        let output =
          "📢 توجه همه اعضای گروه\n\n";

        const mentions = [];

        for (const member of participants) {

          const number =
            member.id ||
            member.jid;

          if (!number) continue;

          output +=
            `@${number.split("@")[0]} `;

          mentions.push(number);
        }

        output +=
          `\n\n🤖 ${BOT_NAME}`;

        await sock.sendMessage(jid, {
          text: output,
          mentions
        });

        return;
      }

      /* ================= HIDETAG ================= */

      if (command === "/hidetag" || command === "hidetag") {

        if (!jid.endsWith("@g.us")) {
          await sock.sendMessage(jid, {
            text: "❌ این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const metadata =
          await sock.groupMetadata(jid);

        const participants =
          metadata.participants || [];

        const mentions =
          participants
            .map((member) =>
              member.id || member.jid
            )
            .filter(Boolean);

        await sock.sendMessage(jid, {
          text: "🔔 توجه همه اعضای گروه",
          mentions
        });

        return;
      }

      /* ================= ADMINS ================= */

      if (command === "/admins" || command === "admins") {

        if (!jid.endsWith("@g.us")) {
          await sock.sendMessage(jid, {
            text: "❌ این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const metadata =
          await sock.groupMetadata(jid);

        const admins =
          (metadata.participants || [])
            .filter(
              (member) =>
                member.admin === "admin" ||
                member.admin === "superadmin"
            );

        if (!admins.length) {
          await sock.sendMessage(jid, {
            text: "❌ مدیر گروه پیدا نشد."
          });
          return;
        }

        let output =
          "👮 مدیران گروه:\n\n";

        const mentions = [];

        for (const admin of admins) {

          const number =
            admin.id ||
            admin.jid;

          if (!number) continue;

          output +=
            `👤 @${number.split("@")[0]}\n`;

          mentions.push(number);
        }

        await sock.sendMessage(jid, {
          text: output,
          mentions
        });

        return;
      }

    } catch (error) {
      console.log(
        "❌ Message Error:",
        error.message
      );
    }
  });
}

console.log(`🚀 ${BOT_NAME} در حال اجرا...`);

startBot().catch((error) => {
  console.log(
    "❌ Fatal Error:",
    error.message
  );
});
