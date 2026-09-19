const readline = require("readline");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");

const BOT_NAME = "اح‍ـــمـــدبــݪاݪ نۅࢪی";
const SESSION = "./session";
const SETTINGS_FILE = "./group-settings.json";

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch (e) {
    console.log("Settings Load Error:", e.message);
  }
  return {};
}

let groupSettings = loadSettings();

function saveSettings() {
  try {
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(groupSettings, null, 2)
    );
  } catch (e) {
    console.log("Settings Save Error:", e.message);
  }
}

function getSettings(jid) {
  if (!groupSettings[jid]) {
    groupSettings[jid] = {
      antilink: false,
      welcome: true,
      bye: true,
      welcomeText: "خوش آمدی به گروه!",
      byeText: "یک عضو از گروه خارج شد."
    };
    saveSettings();
  }

  return groupSettings[jid];
}

function getText(msg) {
  const m = msg.message;
  if (!m) return "";

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  ).trim();
}

function cleanJid(jid) {
  if (!jid) return "";

  return jid
    .split(":")[0]
    .split("@")[0]
    .replace(/\D/g, "");
}

function sameUser(a, b) {
  return cleanJid(a) !== "" && cleanJid(a) === cleanJid(b);
}

function isAdmin(metadata, user) {
  if (!metadata || !user) return false;

  const participant = metadata.participants?.find(
    p => sameUser(p.id, user)
  );

  return !!(
    participant &&
    (
      participant.admin === "admin" ||
      participant.admin === "superadmin"
    )
  );
}

function hasLink(text) {
  return /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|telegram\.me\/)/i.test(text);
}

function getMentions(msg) {
  return (
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    msg.message?.imageMessage?.contextInfo?.mentionedJid ||
    msg.message?.videoMessage?.contextInfo?.mentionedJid ||
    []
  );
}

async function send(sock, jid, content) {
  try {
    await sock.sendMessage(jid, content);
  } catch (e) {
    console.log("Send Error:", e.message);
  }
}

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);

  if (!state.creds.registered) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const phoneNumber = await new Promise(resolve => {
      rl.question(
        "شماره واتساپ را بدون + و فاصله وارد کن: ",
        answer => resolve(answer)
      );
    });

    rl.close();

    const cleanPhone = phoneNumber.replace(/\D/g, "");

    if (!cleanPhone) {
      console.log("شماره نامعتبر است.");
      return;
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const code = await sock.requestPairingCode(cleanPhone);

      console.log("");
      console.log("==============================");
      console.log("کد Pairing:", code);
      console.log("==============================");
      console.log("در واتساپ برو به:");
      console.log("دستگاه‌های مرتبط → اتصال دستگاه → اتصال با شماره تلفن");
      console.log("==============================");
      console.log("");
    } catch (e) {
      console.log("خطا در گرفتن کد Pairing:", e.message);
    }
  }

  sock.ev.on("creds.update", saveCreds);

  if (!state.creds.registered) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));

      const code = await sock.requestPairingCode(cleanPhone);

      console.log("");
      console.log("==============================");
      console.log("کد Pairing:", code);
      console.log("==============================");
      console.log("WhatsApp → Linked Devices → Link with phone number");
      console.log("==============================");
      console.log("");
    } catch (e) {
      console.log("خطا در گرفتن کد Pairing:", e.message);
    }
  }



  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect } = update;

    if (connection === "connecting") {
      console.log("در حال اتصال به واتساپ...");
    }

    if (connection === "open") {
      console.log("");
      console.log("================================");
      console.log(BOT_NAME + " وصل شد!");
      console.log("ربات فعال است");
      console.log("================================");
      console.log("");
    }

    if (connection === "close") {
      const code =
        lastDisconnect?.error?.output?.statusCode;

      console.log("اتصال قطع شد. کد:", code);

      if (code !== DisconnectReason.loggedOut) {
        console.log("در حال اتصال دوباره...");
        setTimeout(startBot, 5000);
      } else {
        console.log("جلسه واتساپ خارج شده است.");
      }
    }
  });

  sock.ev.on("group-participants.update", async update => {
    try {
      const settings = getSettings(update.id);

      if (update.action === "add" && settings.welcome) {
        for (const user of update.participants || []) {
          await send(sock, update.id, {
            text:
              settings.welcomeText +
              "\n\nعضو جدید: @" +
              cleanJid(user) +
              "\n\n" +
              BOT_NAME,
            mentions: [user]
          });
        }
      }

      if (update.action === "remove" && settings.bye) {
        for (const user of update.participants || []) {
          await send(sock, update.id, {
            text:
              settings.byeText +
              "\n\nعضو: @" +
              cleanJid(user) +
              "\n\n" +
              BOT_NAME,
            mentions: [user]
          });
        }
      }
    } catch (e) {
      console.log("Participant Error:", e.message);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages?.[0];

      if (!msg || !msg.message) return;

      const jid = msg.key.remoteJid;

      if (!jid || jid === "status@broadcast") return;

      const text = getText(msg);

      if (!text) return;

      const lower = text.toLowerCase().trim();

      const isGroup = jid.endsWith("@g.us");

      let metadata = null;

      if (isGroup) {
        try {
          metadata = await sock.groupMetadata(jid);
        } catch (e) {
          console.log("Metadata Error:", e.message);
        }
      }

      const sender =
        msg.key.participant ||
        msg.participant ||
        msg.key.remoteJid;

      const botId = sock.user?.id || "";

      const senderIsAdmin =
        isGroup && isAdmin(metadata, sender);

      const botIsAdmin =
        isGroup && isAdmin(metadata, botId);

      const settings =
        isGroup ? getSettings(jid) : null;

      if (
        isGroup &&
        settings.antilink &&
        !msg.key.fromMe &&
        hasLink(text)
      ) {
        if (!senderIsAdmin) {
          try {
            await sock.sendMessage(jid, {
              delete: msg.key
            });
          } catch (e) {
            console.log("Delete Link Error:", e.message);
          }

          if (botIsAdmin) {
            try {
              await sock.groupParticipantsUpdate(
                jid,
                [sender],
                "remove"
              );

              await send(sock, jid, {
                text:
                  "لینک ممنوع است.\nپیام حذف شد و فرستنده از گروه حذف گردید."
              });
            } catch (e) {
              await send(sock, jid, {
                text:
                  "لینک حذف شد، اما حذف فرستنده انجام نشد."
              });
            }
          } else {
            await send(sock, jid, {
              text:
                "لینک حذف شد.\nبرای حذف فرستنده، ربات باید مدیر گروه باشد."
            });
          }

          return;
        }
      }

      if (
        lower === ".ping" ||
        lower === "/ping" ||
        lower === "ping"
      ) {
        await send(sock, jid, {
          text: "PONG"
        });
        return;
      }

      if (
        lower === ".menu" ||
        lower === "/menu" ||
        lower === "menu"
      ) {
        await send(sock, jid, {
          text:
            "منوی " +
            BOT_NAME +
            "\n\n" +
            ".ping\n" +
            ".help\n" +
            ".rules\n" +
            ".info\n" +
            ".groupinfo\n" +
            ".admins\n" +
            ".tagall\n" +
            ".hidetag\n" +
            ".tagadmin\n" +
            ".antilink on\n" +
            ".antilink off\n" +
            ".welcome on\n" +
            ".welcome off\n" +
            ".bye on\n" +
            ".bye off\n" +
            ".settings\n" +
            ".linkphoto\n" +
            ".remove\n" +
            ".kick\n" +
            ".promote\n" +
            ".demote\n" +
            ".mute\n" +
            ".unmute\n" +
            ".owner"
        });
        return;
      }

      if (
        lower === ".help" ||
        lower === "/help" ||
        lower === "help"
      ) {
        await send(sock, jid, {
          text:
            "راهنمای دستورات:\n\n" +
            ".ping - تست ربات\n" +
            ".menu - منو\n" +
            ".rules - قوانین\n" +
            ".info - معلومات گروه\n" +
            ".groupinfo - معلومات گروه\n" +
            ".admins - مدیران\n" +
            ".tagall - تگ همه\n" +
            ".hidetag - تگ مخفی همه\n" +
            ".tagadmin - تگ مدیران\n" +
            ".antilink on/off - ضد لینک\n" +
            ".welcome on/off - خوش آمدگویی\n" +
            ".bye on/off - پیام خروج\n" +
            ".settings - تنظیمات\n" +
            ".linkphoto - عکس و لینک گروه\n" +
            ".remove - حذف عضو تگ‌شده\n" +
            ".kick - حذف عضو تگ‌شده\n" +
            ".promote - مدیر کردن\n" +
            ".demote - گرفتن مدیریت\n" +
            ".mute - بستن گروه\n" +
            ".unmute - باز کردن گروه\n" +
            ".owner - مالک گروه"
        });
        return;
      }

      if (
        lower === ".rules" ||
        lower === "/rules" ||
        lower === "rules"
      ) {
        await send(sock, jid, {
          text:
            "قوانین گروه:\n\n" +
            "1. احترام به اعضا\n" +
            "2. رعایت قوانین گروه\n" +
            "3. ارسال لینک بدون اجازه ممنوع\n\n" +
            BOT_NAME
        });
        return;
      }

      if (
        lower === ".info" ||
        lower === "/info" ||
        lower === "info" ||
        lower === ".groupinfo" ||
        lower === "/groupinfo" ||
        lower === "groupinfo"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const participants =
          metadata?.participants || [];

        const admins =
          participants.filter(
            p =>
              p.admin === "admin" ||
              p.admin === "superadmin"
          );

        await send(sock, jid, {
          text:
            "معلومات گروه:\n\n" +
            "نام: " +
            (metadata?.subject || "نامشخص") +
            "\n" +
            "اعضا: " +
            participants.length +
            "\n" +
            "مدیران: " +
            admins.length +
            "\n" +
            "آیدی:\n" +
            jid
        });

        return;
      }

      if (
        lower === ".admins" ||
        lower === "/admins" ||
        lower === "admins"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const admins =
          metadata?.participants?.filter(
            p =>
              p.admin === "admin" ||
              p.admin === "superadmin"
          ) || [];

        const mentions =
          admins.map(p => p.id);

        let out = "مدیران گروه:\n\n";

        admins.forEach((p, i) => {
          out +=
            (i + 1) +
            ". @" +
            cleanJid(p.id) +
            "\n";
        });

        await send(sock, jid, {
          text: out,
          mentions
        });

        return;
      }

      if (
        lower === ".tagall" ||
        lower === "/tagall" ||
        lower === "tagall"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const members =
          metadata?.participants || [];

        const mentions =
          members.map(p => p.id);

        let out = "اعضای گروه:\n\n";

        members.forEach((p, i) => {
          out +=
            (i + 1) +
            ". @" +
            cleanJid(p.id) +
            "\n";
        });

        await send(sock, jid, {
          text: out,
          mentions
        });

        return;
      }

      if (
        lower === ".hidetag" ||
        lower === "/hidetag" ||
        lower === "hidetag"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const members =
          metadata?.participants || [];

        await send(sock, jid, {
          text: "اعضای گروه",
          mentions: members.map(p => p.id)
        });

        return;
      }

      if (
        lower === ".tagadmin" ||
        lower === "/tagadmin" ||
        lower === "tagadmin"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const admins =
          metadata?.participants?.filter(
            p =>
              p.admin === "admin" ||
              p.admin === "superadmin"
          ) || [];

        await send(sock, jid, {
          text: "مدیران گروه",
          mentions: admins.map(p => p.id)
        });

        return;
      }

      if (
        lower === ".antilink on" ||
        lower === "/antilink on" ||
        lower === "antilink on" ||
        lower === ".antilink off" ||
        lower === "/antilink off" ||
        lower === "antilink off"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text:
              "فقط مدیر گروه می‌تواند این تنظیم را تغییر دهد."
          });
          return;
        }

        settings.antilink =
          lower.endsWith("on");

        saveSettings();

        await send(sock, jid, {
          text:
            settings.antilink
              ? "ضد لینک فعال شد."
              : "ضد لینک خاموش شد."
        });

        return;
      }

      if (
        lower === ".welcome on" ||
        lower === "/welcome on" ||
        lower === "welcome on" ||
        lower === ".welcome off" ||
        lower === "/welcome off" ||
        lower === "welcome off"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text:
              "فقط مدیر گروه می‌تواند این تنظیم را تغییر دهد."
          });
          return;
        }

        settings.welcome =
          lower.endsWith("on");

        saveSettings();

        await send(sock, jid, {
          text:
            settings.welcome
              ? "پیام خوش آمدگویی فعال شد."
              : "پیام خوش آمدگویی خاموش شد."
        });

        return;
      }

      if (
        lower === ".bye on" ||
        lower === "/bye on" ||
        lower === "bye on" ||
        lower === ".bye off" ||
        lower === "/bye off" ||
        lower === "bye off"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text:
              "فقط مدیر گروه می‌تواند این تنظیم را تغییر دهد."
          });
          return;
        }

        settings.bye =
          lower.endsWith("on");

        saveSettings();

        await send(sock, jid, {
          text:
            settings.bye
              ? "پیام خروج فعال شد."
              : "پیام خروج خاموش شد."
        });

        return;
      }

      if (
        lower === ".settings" ||
        lower === "/settings" ||
        lower === "settings"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        await send(sock, jid, {
          text:
            "تنظیمات گروه:\n\n" +
            "ضد لینک: " +
            (settings.antilink ? "فعال" : "خاموش") +
            "\n" +
            "خوش آمدگویی: " +
            (settings.welcome ? "فعال" : "خاموش") +
            "\n" +
            "پیام خروج: " +
            (settings.bye ? "فعال" : "خاموش")
        });

        return;
      }

      if (
        lower === ".linkphoto" ||
        lower === "/linkphoto" ||
        lower === "linkphoto" ||
        lower === ".لینک عکس" ||
        lower === "/لینک عکس" ||
        lower === "لینک عکس"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        try {
          const groupName =
            metadata?.subject || "گروه";

          const invite =
            await sock.groupInviteCode(jid);

          const link =
            "https://chat.whatsapp.com/" +
            invite;

          let imageUrl = null;

          try {
            imageUrl =
              await sock.profilePictureUrl(
                jid,
                "image"
              );
          } catch (e) {}

          const caption =
            "نام گروه: " +
            groupName +
            "\n\n" +
            "لینک گروه:\n" +
            link +
            "\n\n" +
            BOT_NAME;

          if (imageUrl) {
            await send(sock, jid, {
              image: { url: imageUrl },
              caption
            });
          } else {
            await send(sock, jid, {
              text: caption
            });
          }
        } catch (e) {
          await send(sock, jid, {
            text:
              "گرفتن لینک گروه انجام نشد."
          });
        }

        return;
      }

      const removeCommand =
        lower === ".remove" ||
        lower === "/remove" ||
        lower === "remove" ||
        lower === ".kick" ||
        lower === "/kick" ||
        lower === "kick";

      if (removeCommand) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text:
              "فقط مدیر گروه می‌تواند این دستور را استفاده کند."
          });
          return;
        }

        if (!botIsAdmin) {
          await send(sock, jid, {
            text:
              "ربات باید مدیر گروه باشد."
          });
          return;
        }

        const mentions =
          getMentions(msg);

        if (!mentions.length) {
          await send(sock, jid, {
            text:
              "عضو را تگ کن و بعد .remove یا .kick را بزن."
          });
          return;
        }

        for (const target of mentions) {
          if (sameUser(target, botId)) {
            await send(sock, jid, {
              text: "ربات را نمی‌توان حذف کرد."
            });
            continue;
          }

          if (isAdmin(metadata, target)) {
            await send(sock, jid, {
              text:
                "مدیر گروه را نمی‌توان حذف کرد."
            });
            continue;
          }

          try {
            await sock.groupParticipantsUpdate(
              jid,
              [target],
              "remove"
            );

            await send(sock, jid, {
              text: "عضو از گروه حذف شد."
            });
          } catch (e) {
            await send(sock, jid, {
              text:
                "حذف عضو انجام نشد."
            });
          }
        }

        return;
      }

      if (
        lower === ".promote" ||
        lower === "/promote" ||
        lower === "promote"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin || !botIsAdmin) {
          await send(sock, jid, {
            text:
              "فرستنده و ربات باید مدیر گروه باشند."
          });
          return;
        }

        const mentions =
          getMentions(msg);

        if (!mentions.length) {
          await send(sock, jid, {
            text: "عضو موردنظر را تگ کن."
          });
          return;
        }

        for (const target of mentions) {
          try {
            await sock.groupParticipantsUpdate(
              jid,
              [target],
              "promote"
            );
          } catch (e) {
            await send(sock, jid, {
              text:
                "مدیر کردن انجام نشد."
            });
          }
        }

        await send(sock, jid, {
          text: "عضو مدیر شد."
        });

        return;
      }

      if (
        lower === ".demote" ||
        lower === "/demote" ||
        lower === "demote"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin || !botIsAdmin) {
          await send(sock, jid, {
            text:
              "فرستنده و ربات باید مدیر گروه باشند."
          });
          return;
        }

        const mentions =
          getMentions(msg);

        if (!mentions.length) {
          await send(sock, jid, {
            text: "مدیر موردنظر را تگ کن."
          });
          return;
        }

        for (const target of mentions) {
          try {
            await sock.groupParticipantsUpdate(
              jid,
              [target],
              "demote"
            );
          } catch (e) {
            await send(sock, jid, {
              text:
                "گرفتن مدیریت انجام نشد."
            });
          }
        }

        await send(sock, jid, {
          text: "مدیریت عضو گرفته شد."
        });

        return;
      }

      if (
        lower === ".mute" ||
        lower === "/mute" ||
        lower === "mute"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin || !botIsAdmin) {
          await send(sock, jid, {
            text:
              "فرستنده و ربات باید مدیر گروه باشند."
          });
          return;
        }

        try {
          await sock.groupSettingUpdate(
            jid,
            "announcement"
          );

          await send(sock, jid, {
            text:
              "گروه بسته شد. فقط مدیران می‌توانند پیام بفرستند."
          });
        } catch (e) {
          await send(sock, jid, {
            text:
              "بستن گروه انجام نشد."
          });
        }

        return;
      }

      if (
        lower === ".unmute" ||
        lower === "/unmute" ||
        lower === "unmute"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin || !botIsAdmin) {
          await send(sock, jid, {
            text:
              "فرستنده و ربات باید مدیر گروه باشند."
          });
          return;
        }

        try {
          await sock.groupSettingUpdate(
            jid,
            "not_announcement"
          );

          await send(sock, jid, {
            text:
              "گروه باز شد. همه اعضا می‌توانند پیام بفرستند."
          });
        } catch (e) {
          await send(sock, jid, {
            text:
              "باز کردن گروه انجام نشد."
          });
        }

        return;
      }

      if (
        lower === ".owner" ||
        lower === "/owner" ||
        lower === "owner"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const owner =
          metadata?.owner ||
          metadata?.subjectOwner;

        if (owner) {
          await send(sock, jid, {
            text:
              "مالک گروه:\n@" +
              cleanJid(owner),
            mentions: [owner]
          });
        } else {
          await send(sock, jid, {
            text:
              "معلومات مالک گروه از واتساپ دریافت نشد."
          });
        }

        return;
      }

    } catch (e) {
      console.log("Message Error:", e.message);
    }
  });
}

startBot().catch(err => {
  console.log("Start Error:", err.message);
});
