const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const readline = require("readline");

const BOT_NAME = "اح‍ـــمـــدبــݪاݪ نۅࢪی";
const SESSION = "./session";
const SETTINGS_FILE = "./group-settings.json";

let groupSettings = {};

if (fs.existsSync(SETTINGS_FILE)) {
  try {
    groupSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    groupSettings = {};
  }
}

function saveSettings() {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(groupSettings, null, 2)
  );
}

function settings(jid) {
  if (!groupSettings[jid]) {
    groupSettings[jid] = {
      antilink: false,
      welcome: true
    };
    saveSettings();
  }
  return groupSettings[jid];
}

function getText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ""
  );
}

function sameUser(a, b) {
  if (!a || !b) return false;
  return (
    a === b ||
    a.split(":")[0] === b.split(":")[0] ||
    a.split("@")[0] === b.split("@")[0]
  );
}

function isAdmin(p) {
  return (
    p?.admin === "admin" ||
    p?.admin === "superadmin"
  );
}

function hasLink(text) {
  return /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|instagram\.com\/|youtube\.com\/|youtu\.be\/)/i.test(text);
}

async function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

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

  sock.ev.on("connection.update", async update => {
    const {
      connection,
      lastDisconnect,
      qr
    } = update;

    if (qr) {
      console.log("\nQR دریافت شد:\n");
      qrcode.generate(qr, { small: true });
      console.log(
        "\nWhatsApp → Settings → Linked Devices → Link a Device\n"
      );
    }

    if (connection === "connecting") {
      console.log("در حال اتصال به واتساپ...");
    }

    if (connection === "open") {
      console.log(`
================================
${BOT_NAME} وصل شد!
ربات فعال است
================================
`);
    }

    if (connection === "close") {
      const code =
        lastDisconnect?.error?.output?.statusCode;

      console.log("اتصال بسته شد:", code);

      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => {
          startBot().catch(err =>
            console.log("Restart Error:", err.message)
          );
        }, 3000);
      } else {
        console.log("حساب از واتساپ خارج شده است.");
      }
    }
  });

  sock.ev.on(
    "group-participants.update",
    async update => {
      try {
        if (update.action !== "add") return;

        const jid = update.id;
        const cfg = settings(jid);

        if (!cfg.welcome) return;

        const mentions = update.participants;

        let text = "خوش آمدید!\n\n";

        for (const user of mentions) {
          text += `@${user.split("@")[0]}\n`;
        }

        text += `\n${BOT_NAME}`;

        await sock.sendMessage(jid, {
          text,
          mentions
        });
      } catch (err) {
        console.log("Welcome Error:", err.message);
      }
    }
  );

  sock.ev.on(
    "messages.upsert",
    async ({ messages }) => {
      try {
        const msg = messages[0];

        if (!msg?.message) return;

        const jid = msg.key.remoteJid;

        if (!jid || jid === "status@broadcast") return;

        const text = getText(msg).trim();

        if (!text) return;

        const command = text.toLowerCase();

        let metadata = null;

        if (jid.endsWith("@g.us")) {
          try {
            metadata = await sock.groupMetadata(jid);
          } catch {}
        }

        /* ضد لینک */

        if (
          jid.endsWith("@g.us") &&
          hasLink(text) &&
          settings(jid).antilink
        ) {
          if (!metadata) return;

          const sender =
            msg.key.participant ||
            msg.participant;

          const senderParticipant =
            metadata.participants.find(
              p => sameUser(p.id, sender)
            );

          if (isAdmin(senderParticipant)) return;

          try {
            await sock.sendMessage(jid, {
              delete: msg.key
            });
          } catch {}

          const botId = sock.user?.id;

          const botParticipant =
            metadata.participants.find(
              p => sameUser(p.id, botId)
            );

          if (!isAdmin(botParticipant)) {
            await sock.sendMessage(jid, {
              text:
                "لینک حذف شد.\n\nبرای ریموف کردن فرستنده، ربات باید مدیر گروه باشد."
            });
            return;
          }

          try {
            await sock.groupParticipantsUpdate(
              jid,
              [sender],
              "remove"
            );

            await sock.sendMessage(jid, {
              text:
                "لینک ممنوع است.\nپیام حذف شد و فرستنده ریموف شد."
            });
          } catch (err) {
            console.log("AntiLink Error:", err.message);
          }

          return;
        }

        /* PING */

        if (
          command === ".ping" ||
          command === "/ping" ||
          command === "ping"
        ) {
          await sock.sendMessage(jid, {
            text:
`PONG!

${BOT_NAME}
وضعیت: فعال`
          });
          return;
        }

        /* MENU */

        if (
          command === ".menu" ||
          command === "/menu" ||
          command === "menu"
        ) {
          await sock.sendMessage(jid, {
            text:
`╭━━〔 ${BOT_NAME} 〕━━╮

.ping
.menu
.help
.rules
.info
.admins
.tagall
.hidetag
.antilink
.welcome
.settings
.linkphoto
.remove

╰━━━━━━━━━━━━━━╯`
          });
          return;
        }

        /* HELP */

        if (
          command === ".help" ||
          command === "/help" ||
          command === "help"
        ) {
          await sock.sendMessage(jid, {
            text:
`${BOT_NAME}

.ping
.menu
.rules
.info
.admins
.tagall
.hidetag
.antilink
.welcome
.settings
.linkphoto
.remove`
          });
          return;
        }

        /* RULES */

        if (
          command === ".rules" ||
          command === "/rules" ||
          command === "rules"
        ) {
          await sock.sendMessage(jid, {
            text:
`قوانین گروه:

1. احترام به اعضا
2. عدم ارسال پیام مزاحم
3. عدم ارسال لینک ناخواسته
4. رعایت قوانین واتساپ
5. همکاری با مدیران

${BOT_NAME}`
          });
          return;
        }

        /* INFO */

        if (
          command === ".info" ||
          command === "/info" ||
          command === "info"
        ) {
          await sock.sendMessage(jid, {
            text:
`نام: ${BOT_NAME}
پلتفرم: WhatsApp
موتور: Baileys
وضعیت: آنلاین`
          });
          return;
        }

        /* SETTINGS */

        if (
          command === ".settings" ||
          command === "/settings" ||
          command === "settings"
        ) {
          if (!jid.endsWith("@g.us")) {
            await sock.sendMessage(jid, {
              text: "این دستور فقط در گروه کار می‌کند."
            });
            return;
          }

          const cfg = settings(jid);

          await sock.sendMessage(jid, {
            text:
`تنظیمات گروه:

ضدلینک: ${cfg.antilink ? "روشن" : "خاموش"}
خوش‌آمدگویی: ${cfg.welcome ? "روشن" : "خاموش"}`
          });
          return;
        }

        /* ANTILINK */

        if (
          command === ".antilink" ||
          command === "/antilink" ||
          command === "antilink"
        ) {
          if (!jid.endsWith("@g.us")) {
            await sock.sendMessage(jid, {
              text: "این دستور فقط در گروه کار می‌کند."
            });
            return;
          }

          const sender =
            msg.key.participant ||
            msg.participant;

          if (!metadata) {
            metadata = await sock.groupMetadata(jid);
          }

          const senderParticipant =
            metadata.participants.find(
              p => sameUser(p.id, sender)
            );

          if (!isAdmin(senderParticipant)) {
            await sock.sendMessage(jid, {
              text: "فقط مدیر گروه می‌تواند این تنظیم را تغییر دهد."
            });
            return;
          }

          const cfg = settings(jid);
          cfg.antilink = !cfg.antilink;
          saveSettings();

          await sock.sendMessage(jid, {
            text:
              `ضدلینک ${cfg.antilink ? "روشن" : "خاموش"} شد.`
          });
          return;
        }

        /* WELCOME */

        if (
          command === ".welcome" ||
          command === "/welcome" ||
          command === "welcome"
        ) {
          if (!jid.endsWith("@g.us")) {
            await sock.sendMessage(jid, {
              text: "این دستور فقط در گروه کار می‌کند."
            });
            return;
          }

          const cfg = settings(jid);
          cfg.welcome = !cfg.welcome;
          saveSettings();

          await sock.sendMessage(jid, {
            text:
              `خوش‌آمدگویی ${cfg.welcome ? "روشن" : "خاموش"} شد.`
          });
          return;
        }

        /* ADMINS */

        if (
          command === ".admins" ||
          command === "/admins" ||
          command === "admins"
        ) {
          if (!jid.endsWith("@g.us")) return;

          if (!metadata) {
            metadata = await sock.groupMetadata(jid);
          }

          const admins =
            metadata.participants.filter(p => isAdmin(p));

          const mentions = admins.map(p => p.id);

          let out = "مدیران گروه:\n\n";

          for (const id of mentions) {
            out += `@${id.split("@")[0]}\n`;
          }

          await sock.sendMessage(jid, {
            text: out,
            mentions
          });
          return;
        }

        /* TAGALL */

        if (
          command === ".tagall" ||
          command === "/tagall" ||
          command === "tagall"
        ) {
          if (!jid.endsWith("@g.us")) return;

          if (!metadata) {
            metadata = await sock.groupMetadata(jid);
          }

          const mentions =
            metadata.participants.map(p => p.id);

          let out = "توجه همه اعضای گروه:\n\n";

          for (const id of mentions) {
            out += `@${id.split("@")[0]} `;
          }

          await sock.sendMessage(jid, {
            text: out,
            mentions
          });
          return;
        }

        /* HIDETAG */

        if (
          command === ".hidetag" ||
          command === "/hidetag" ||
          command === "hidetag"
        ) {
          if (!jid.endsWith("@g.us")) return;

          if (!metadata) {
            metadata = await sock.groupMetadata(jid);
          }

          const mentions =
            metadata.participants.map(p => p.id);

          await sock.sendMessage(jid, {
            text: "توجه همه اعضای گروه",
            mentions
          });
          return;
        }

        /* REMOVE */

        if (
          command === ".remove" ||
          command === "/remove" ||
          command === "remove"
        ) {
          if (!jid.endsWith("@g.us")) {
            await sock.sendMessage(jid, {
              text: "این دستور فقط در گروه کار می‌کند."
            });
            return;
          }

          if (!metadata) {
            metadata = await sock.groupMetadata(jid);
          }

          const sender =
            msg.key.participant ||
            msg.participant;

          const senderParticipant =
            metadata.participants.find(
              p => sameUser(p.id, sender)
            );

          if (!isAdmin(senderParticipant)) {
            await sock.sendMessage(jid, {
              text: "فقط مدیر گروه می‌تواند از این دستور استفاده کند."
            });
            return;
          }

          const botId = sock.user?.id;

          const botParticipant =
            metadata.participants.find(
              p => sameUser(p.id, botId)
            );

          if (!isAdmin(botParticipant)) {
            await sock.sendMessage(jid, {
              text: "ربات باید مدیر گروه باشد."
            });
            return;
          }

          const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo;

          const mentioned =
            contextInfo?.mentionedJid || [];

          if (!mentioned.length) {
            await sock.sendMessage(jid, {
              text: "شخص را تگ کن و بعد .remove بنویس."
            });
            return;
          }

          for (const target of mentioned) {
            const targetParticipant =
              metadata.participants.find(
                p => sameUser(p.id, target)
              );

            if (!targetParticipant) continue;

            if (isAdmin(targetParticipant)) {
              await sock.sendMessage(jid, {
                text: "مدیر گروه را نمی‌توان ریموف کرد."
              });
              continue;
            }

            try {
              await sock.groupParticipantsUpdate(
                jid,
                [targetParticipant.id],
                "remove"
              );

              await sock.sendMessage(jid, {
                text:
                  `@${targetParticipant.id.split("@")[0]} از گروه ریموف شد.`,
                mentions: [targetParticipant.id]
              });
            } catch (err) {
              console.log("Remove Error:", err.message);
            }
          }

          return;
        }

        /* LINK PHOTO */

        if (
          command === ".linkphoto" ||
          command === "/linkphoto" ||
          command === "linkphoto" ||
          command === ".لینک عکس" ||
          command === "لینک عکس"
        ) {
          if (!jid.endsWith("@g.us")) return;

          if (!metadata) {
            metadata = await sock.groupMetadata(jid);
          }

          let photo = null;
          let invite = null;

          try {
            photo =
              await sock.profilePictureUrl(
                jid,
                "image"
              );
          } catch {}

          try {
            invite =
              await sock.groupInviteCode(jid);
          } catch {}

          const link =
            invite
              ? `https://chat.whatsapp.com/${invite}`
              : "لینک گروه دریافت نشد.";

          const caption =
`نام گروه:
${metadata.subject || "بدون نام"}

لینک گروه:
${link}

${BOT_NAME}`;

          if (photo) {
            await sock.sendMessage(jid, {
              image: { url: photo },
              caption
            });
          } else {
            await sock.sendMessage(jid, {
              text: caption
            });
          }

          return;
        }

      } catch (err) {
        console.log("Message Error:", err.message);
      }
    }
  );
}

async function main() {
  console.log(`در حال اجرای ${BOT_NAME}...`);
  await startBot();
}

main().catch(err => {
  console.log("Fatal Error:", err.message);
});
