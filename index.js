require("dotenv").config();
const readline = require("readline");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const OpenAI = require("openai");
const fs = require("fs");
const QRCode = require("qrcode");
const qrcode = require("qrcode-terminal");
const { getAutomaticReply } = require("./auto-replies");

const BOT_NAME = "اح‍ـــمـــدبــݪاݪ نۅࢪی";

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

async function askChatGPT(question) {
  const response = await openaiClient.responses.create({
    model: "gpt-5.6-luna",
    instructions:
      "تو دستیار فارسی ربات واتساپ هستی. " +
      "همیشه به زبان فارسی/دری پاسخ بده. " +
      "پاسخ‌ها را واضح، مفید و نسبتاً کوتاه بنویس.",
    input: question
  });

  return response.output_text || "❌ پاسخی دریافت نشد.";
}

const SESSION = "./sessions/main";
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
      raid: false,
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

  const target = String(user);

  const participant = metadata.participants?.find(p => {
    const ids = [
      p.id,
      p.jid,
      p.phoneNumber,
      p.participant,
      p.participantAlt,
      p.lid,
      p.pn
    ].filter(Boolean);

    return ids.some(id => sameUser(id, target));
  });

  return !!(
    participant &&
    (
      participant.admin === "admin" ||
      participant.admin === "superadmin" ||
      participant.admin === "owner"
    )
  );
}


const CHAT_STATS_FILE = "./chat-stats.json";

let chatStats = {};

function loadChatStats() {
  try {
    if (fs.existsSync(CHAT_STATS_FILE)) {
      chatStats = JSON.parse(
        fs.readFileSync(CHAT_STATS_FILE, "utf8")
      );
    }
  } catch (e) {
    console.log("خطا در خواندن آمار:", e.message);
    chatStats = {};
  }
}

let chatStatsSaveTimer = null;

function saveChatStats() {
  if (chatStatsSaveTimer) return;

  chatStatsSaveTimer = setTimeout(() => {
    chatStatsSaveTimer = null;

    try {
      fs.writeFile(
        CHAT_STATS_FILE,
        JSON.stringify(chatStats, null, 2),
        "utf8",
        err => {
          if (err) {
            console.log("خطا در ذخیره آمار:", err.message);
          }
        }
      );
    } catch (e) {
      console.log("خطا در ذخیره آمار:", e.message);
    }
  }, 1000);
}

function getKabulDate(offsetDays = 0) {
  const now = new Date();

  if (offsetDays !== 0) {
    now.setTime(
      now.getTime() + offsetDays * 24 * 60 * 60 * 1000
    );
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const obj = {};

  for (const x of parts) {
    if (x.type !== "literal") {
      obj[x.type] = x.value;
    }
  }

  return (
    obj.year +
    "-" +
    obj.month +
    "-" +
    obj.day
  );
}

function getUserStats(jid) {
  const id = cleanJid(jid);

  if (!chatStats[id]) {
    chatStats[id] = {
      total: 0,
      days: {}
    };
  }

  if (!chatStats[id].days) {
    chatStats[id].days = {};
  }

  return chatStats[id];
}

function addChatMessage(jid) {
  const id = cleanJid(jid);

  if (!id) return;

  const stats = getUserStats(id);
  const today = getKabulDate(0);

  stats.total =
    Number(stats.total || 0) + 1;

  stats.days[today] =
    Number(stats.days[today] || 0) + 1;

  saveChatStats();
}

function getChatRank(jid) {
  const id = cleanJid(jid);

  const users = Object.entries(chatStats)
    .map(([user, data]) => ({
      user,
      total: Number(data?.total || 0)
    }))
    .filter(x => x.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }

      return a.user.localeCompare(b.user);
    });

  const index =
    users.findIndex(x => x.user === id);

  return index === -1 ? "-" : index + 1;
}

function getTopChatUsers(limit = 10) {
  return Object.entries(chatStats)
    .map(([user, data]) => ({
      user,
      total: Number(data?.total || 0)
    }))
    .filter(x => x.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }

      return a.user.localeCompare(b.user);
    })
    .slice(0, limit);
}

function getMemberName(metadata, jid) {
  if (metadata?.participants) {
    const participant = metadata.participants.find(p => {
      const ids = [
        p.id,
        p.jid,
        p.phoneNumber,
        p.participant,
        p.participantAlt,
        p.lid,
        p.pn
      ].filter(Boolean);

      return ids.some(id => sameUser(id, jid));
    });

    if (participant) {
      const name =
        participant.notify ||
        participant.name ||
        participant.vname ||
        participant.verifiedName ||
        "";

      if (String(name).trim()) {
        return String(name).trim();
      }

      const phoneFields = [
        participant.phoneNumber,
        participant.pn,
        participant.jid,
        participant.participant,
        participant.participantAlt
      ].filter(Boolean);

      for (const value of phoneFields) {
        const text = String(value);

        if (text.endsWith("@s.whatsapp.net")) {
          const number = text.split("@")[0].replace(/\D/g, "");

          if (number) {
            return "+" + number;
          }
        }
      }
    }
  }

  if (String(jid).endsWith("@s.whatsapp.net")) {
    const number = String(jid).split("@")[0].replace(/\D/g, "");

    if (number) {
      return "+" + number;
    }
  }

  return "عضو گروپ";
}

loadChatStats();

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

const faceSockets = new Map();
let facePairCounter = 0;

async function createFacePair(sock, requesterJid) {
  const number = cleanJid(requesterJid);

  if (!number) {
    await send(sock, requesterJid, {
      text: "شناسه کاربر دریافت نشد."
    });
    return;
  }

  fs.mkdirSync("./sessions", { recursive: true });

  const pairId =
    Date.now().toString(36) +
    "-" +
    (++facePairCounter) +
    "-" +
    Math.random().toString(36).slice(2, 10);

  const sessionPath = "./sessions/pair-" + pairId;

  let face = null;
  let reconnecting = false;

  const connectFace = async () => {
    const { state, saveCreds } =
      await useMultiFileAuthState(sessionPath);

    face = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      browser: Browsers.ubuntu("Belal Noori Bot"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 30000,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false
    });

    faceSockets.set(pairId, face);

    face.ev.on("creds.update", saveCreds);

    let qrSent = false;

    face.ev.on("connection.update", async update => {
      try {
        const {
          connection,
          qr,
          lastDisconnect
        } = update;

        if (qr && !qrSent) {
          qrSent = true;

          const dataUrl =
            await QRCode.toDataURL(qr, {
              errorCorrectionLevel: "H",
              margin: 2,
              width: 900
            });

          const imageBuffer = Buffer.from(
            dataUrl.split(",")[1],
            "base64"
          );

          await send(sock, requesterJid, {
            image: imageBuffer,
            caption:
              "QR اتصال آماده است.\n\n" +
              "واتساپ → دستگاه‌های مرتبط → اتصال دستگاه\n" +
              "سپس این QR را اسکن کن.\n\n" +
              "این QR مخصوص همین Session است."
          });

          console.log("QR ساخته شد:", pairId);
        }

        if (connection === "open") {
          reconnecting = false;

          console.log(
            "Face وصل شد:",
            pairId
          );

          await send(sock, requesterJid, {
            text:
              "اتصال موفق شد. ✅\n" +
              "این Session فعال و آماده کار است."
          });
        }

        if (connection === "close") {
          const code =
            lastDisconnect?.error?.output?.statusCode;

          console.log(
            "Face قطع شد:",
            pairId,
            "کد:",
            code
          );

          if (code === DisconnectReason.loggedOut) {
            faceSockets.delete(pairId);

            await send(sock, requesterJid, {
              text:
                "این Session از واتساپ خارج شد."
            });

            return;
          }

          if (!reconnecting) {
            reconnecting = true;

            console.log(
              "Face در حال اتصال مجدد:",
              pairId
            );

            setTimeout(async () => {
              try {
                await connectFace();
              } catch (e) {
                reconnecting = false;

                console.log(
                  "Face Reconnect Error:",
                  pairId,
                  e.message
                );
              }
            }, 1000);
          }
        }
      } catch (e) {
        console.log(
          "Face Connection Error:",
          pairId,
          e.message
        );
      }
    });

    face.ev.on("messages.upsert", async event => {
      try {
        if (event.type !== "notify") return;

        for (const m of event.messages || []) {
          if (!m.message) continue;

          console.log(
            "Face message:",
            pairId,
            m.key.remoteJid
          );

          const faceJid = m.key.remoteJid;
          const faceText =
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            "";

          if (
            faceText.trim().toLowerCase() === ".ping" ||
            faceText.trim().toLowerCase() === "ping"
          ) {
            await face.sendMessage(faceJid, {
              text: "🏓 " + BOT_NAME + " فعال است ✅"
            });
          }
        }
      } catch (e) {
        console.log(
          "Face Message Error:",
          pairId,
          e.message
        );
      }
    });
  };

  try {
    await connectFace();

    await send(sock, requesterJid, {
      text:
        "در حال ساخت QR اتصال...\n" +
        "لطفاً چند لحظه صبر کن."
    });
  } catch (e) {
    console.log(
      "Face Pair Error:",
      pairId,
      e.message
    );

    faceSockets.delete(pairId);

    await send(sock, requesterJid, {
      text:
        "خطا در ساخت این QR.\n" +
        "دوباره .pair بفرست."
    });
  }
}

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION);

  const sock = makeWASocket({

    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("Belal Noori Bot"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 30000,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false
  });

  console.log("SEND_NODE TYPE:", typeof sock.sendNode);
  console.log("SOCKET METHODS:", Object.keys(sock).filter(k => k.toLowerCase().includes("node")));

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("QR اصلی را اسکن کن:");
      qrcode.generate(qr, { small: true });

      try {
        await fetch("http://127.0.0.1:8787/api/qr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ qr })
        });

        console.log("QR به پنل ارسال شد.");
      } catch (err) {
        console.log("QR Panel Error:", err.message);
      }
    }
    if (connection === "connecting") {
      console.log("در حال اتصال به واتساپ...");
    }

    if (connection === "open") {
      console.log("");
      console.log("================================");
      console.log(BOT_NAME + " وصل شد!");
      console.log("اح‍ـــمـــدبــݪاݪ فعال است");
      console.log("================================");
      console.log("");
    }

    if (connection === "close") {
      const code =
        lastDisconnect?.error?.output?.statusCode;

      console.log("اتصال قطع شد. کد:", code);

      if (code !== DisconnectReason.loggedOut) {
        if (!globalThis.__botReconnectTimer) {
          console.log("در حال اتصال دوباره...");
          globalThis.__botReconnectTimer = setTimeout(() => {
            globalThis.__botReconnectTimer = null;
            startBot().catch(err => {
              console.log("Reconnect Error:", err.message);
            });
          }, 10000);
        } else {
          console.log("اتصال مجدد از قبل زمان‌بندی شده است.");
        }
      } else {
        console.log("جلسه واتساپ خارج شده است.");
      }
    }
  });

  let lastWelcomeMessages = new Map();

  sock.ev.on("group-participants.update", async update => {
    try {
      const settings = getSettings(update.id);




      if (update.action === "add" && settings.welcome) {
        const groupMetadata = await sock.groupMetadata(update.id);
        const groupName = groupMetadata?.subject || "گروپ ما";
        const memberCount = groupMetadata?.participants?.length || 0;

        for (const user of update.participants || []) {

          const oldWelcome = lastWelcomeMessages.get(update.id);

          if (oldWelcome) {
            try {
              await sock.sendMessage(update.id, {
                delete: oldWelcome
              });
            } catch (e) {
              console.log("پیام قبلی حذف نشد:", e.message);
            }
          }

          const welcomeText =
            "╭───❀ خوش آمدی ❀───╮\n\n" +
            "خوش آمدی @" + cleanJid(user) + " عزیز\n\n" +
            "به گروپ " + groupName + " خوش آمدی.\n" +
            "امیدواریم لحظات خوبی در کنار ما داشته باشی.\n\n" +
            "تعداد اعضای گروپ: " + memberCount + "\n\n" +
            "لطفاً قوانین گروپ را رعایت کن.\n\n" +
            "برای مطالب و اطلاعیه‌های بیشتر:\n" +
            "کانال ما:\n" +
            "https://whatsapp.com/channel/0029VbDQIGtDuMRjUa47Jl20\n\n" +
            BOT_NAME +
            "\n╰────────────────╯";

          let sent = null;

          try {
            const imageUrl = await sock.profilePictureUrl(user, "image");

            if (imageUrl) {
              const response = await fetch(imageUrl);

              if (response.ok) {
                const imageBuffer = Buffer.from(
                  await response.arrayBuffer()
                );

                sent = await sock.sendMessage(update.id, {
                  image: imageBuffer,
                  caption: welcomeText,
                  mentions: [user]
                });
              }
            }
          } catch (e) {
            console.log("عکس پروفایل در دسترس نیست.");
          }

          if (!sent) {
            sent = await sock.sendMessage(update.id, {
              text: welcomeText,
              mentions: [user]
            });
          }

          if (sent?.key) {
            lastWelcomeMessages.set(update.id, sent.key);
          }
        }
      }

      if (update.action === "remove" && settings.bye) {
        for (const user of update.participants || []) {
          await send(sock, update.id, {
            text:
              "╭━━━〔 👻 خداحافظ 〕━━━╮\n" +
              "┃\n" +
              "┃ 🚪 رفتی لایق گرو، ما نبودی! 😏\n" +
              "┃\n" +
              "┃ 👤 عضو: @" + cleanJid(user) + "\n" +
              "┃\n" +
              "┃ 👻 " + BOT_NAME + "\n" +
              "┃\n" +
              "╰━━━━━━━━━━━━━━━━━━╯",
            mentions: [user]
          });
        }
      }


    } catch (e) {
      console.log("Participant Error:", e.message);
    }
  });

  // ===== MENU_SYSTEM_START =====
function ahmadBilalMenu() {
  return `╭━━━〔 👻 اح‍ـــمـــدبــݪاݪ نۅࢪی 〕━━━╮
┃
┃       ✦ منوی اصلی ربات ✦
┃
┃ ⚡━━━「 دستورات اصلی 」━━━⚡
┃
┃ ◈ .pair
┃   ↳ ساخت فیس جدید
┃ ◈ .ping
┃   ↳ بررسی پاسخ ربات
┃ ◈ .movie نام
┃   ↳ معلومات فیلم
┃ ◈ .عکس متن
┃   ↳ ساخت تصویر با هوش مصنوعی
┃ ◈ .ادیت متن
┃   ↳ ادیت عکس با Reply
┃ ◈ .ai سوال
┃   ↳ گفتگو با هوش مصنوعی
┃ ◈ .هوش سوال
┃   ↳ پاسخ فارسی هوش مصنوعی
┃ ◈ .help
┃   ↳ راهنمای دستورات
┃ ◈ .info
┃   ↳ معلومات ربات
┃ ◈ .owner
┃   ↳ معلومات صاحب ربات
┃
┃ 👥━━━「 مدیریت گروپ 」━━━👥
┃
┃ ◈ .rules
┃   ↳ نمایش قوانین
┃ ◈ .groupinfo
┃   ↳ معلومات گروپ
┃ ◈ .admins
┃   ↳ نمایش ادمین‌ها
┃ ◈ .tagall
┃   ↳ منشن همه اعضا
┃ ◈ .hidetag
┃   ↳ تگ بدون نمایش منشن
┃ ◈ .tagadmin
┃   ↳ منشن ادمین‌ها
┃
┃ 🛡️━━━「 محافظت 」━━━🛡️
┃
┃ ◈ .antilink on
┃   ↳ فعال‌سازی ضدلینک
┃ ◈ .antilink off
┃   ↳ خاموش‌سازی ضدلینک
┃ ◈ .welcome on
┃   ↳ فعال‌سازی خوش‌آمد
┃ ◈ .welcome off
┃   ↳ خاموش‌سازی خوش‌آمد
┃ ◈ .bye on
┃   ↳ فعال‌سازی خداحافظی
┃ ◈ .bye off
┃   ↳ خاموش‌سازی خداحافظی
┃ ◈ .settings
┃   ↳ نمایش تنظیمات
┃
┃ 👑━━━「 مدیریت اعضا 」━━━👑
┃
┃ ◈ .remove
┃   ↳ حذف عضو
┃ ◈ .kick
┃   ↳ اخراج عضو
┃ ◈ .promote
┃   ↳ ادمین‌کردن عضو
┃ ◈ .demote
┃   ↳ عزل ادمین
┃ ◈ .mute
┃   ↳ بستن ارسال پیام
┃ ◈ .unmute
┃   ↳ بازکردن ارسال پیام
┃
┃ 🔗━━━「 امکانات ویژه 」━━━🔗
┃
┃ ◈ .linkphoto
┃   ↳ تنظیم عکس/لینک گروپ
┃
╰━━━〔 👻 اح‍ـــمـــدبــݪاݪ نۅࢪی 〕━━━╯`;
}

// ===== MENU_SYSTEM_END =====

sock.ev.on("messages.upsert", async ({ messages }) => {

    console.log("📩 MESSAGE EVENT:", messages?.length || 0);

    try {
      const msg = messages?.[0];

      if (!msg || !msg.message) return;


      const jid = msg.key.remoteJid;

      // ثبت آمار پیام‌های اعضای گروپ
      if (
        jid &&
        jid.endsWith("@g.us") &&
        !msg.key.fromMe
      ) {
        const statsUserRaw =
          msg.key.participant ||
          msg.participant ||
          "";

        let statsUser =
          statsUserRaw;

        // ===== LID/JID STATS MAP =====
        try {
          const statsMetadata =
            metadata ||
            await sock.groupMetadata(jid);

          const statsParticipant =
            statsMetadata?.participants?.find(p => {
              const ids = [
                p.id,
                p.jid,
                p.phoneNumber,
                p.pn,
                p.participant,
                p.participantAlt,
                p.lid
              ].filter(Boolean);

              return ids.some(id =>
                cleanJid(id) === cleanJid(statsUserRaw)
              );
            });

          if (statsParticipant) {
            const lidKeys = [
              statsParticipant.id,
              statsParticipant.lid
            ]
              .filter(Boolean)
              .map(cleanJid)
              .filter(Boolean);

            const phoneKeys = [
              statsParticipant.jid,
              statsParticipant.phoneNumber,
              statsParticipant.pn,
              statsParticipant.participant,
              statsParticipant.participantAlt
            ]
              .filter(Boolean)
              .map(cleanJid)
              .filter(x => x.length >= 8);

            const allKeys = [...new Set([
              ...lidKeys,
              ...phoneKeys
            ])];

            // رکورد قدیمی را پیدا کن
            let merged = null;

            for (const key of allKeys) {
              if (chatStats[key]) {
                merged = chatStats[key];
                break;
              }
            }

            // همه alias ها را به همان رکورد وصل کن
            if (merged) {
              for (const key of allKeys) {
                chatStats[key] = merged;
              }
            }

            // همیشه شماره واقعی را برای ثبت آمار ترجیح بده
            if (phoneKeys.length > 0) {
              statsUser = phoneKeys[0];
            } else if (lidKeys.length > 0) {
              statsUser = lidKeys[0];
            }
          }
        } catch (e) {
          console.log(
            "STATS MEMBER MAP ERROR:",
            e.message
          );
        }

        if (statsUser) {
          addChatMessage(statsUser);
        }
      }


      if (!jid || jid === "status@broadcast") return;

      const text = getText(msg);

      if (!text) return;

      const lower = text.toLowerCase().trim();

// ===== پاسخ‌های خودکار دری/افغانی =====
const automaticReply = getAutomaticReply(text);

if (automaticReply) {
  try {
    await send(sock, jid, { text: automaticReply });
  } catch (autoReplyError) {
    console.log("AUTO REPLY ERROR:", autoReplyError.message);
  }
  return;
}
// ===== پایان پاسخ‌های خودکار =====

      
      

      

      // ===== CREATOR_COMMAND_START =====
      if (lower === ".creator" || lower === ".سازنده") {
        await send(sock, jid, {
          text:
            "╭━━━〔 👑 سازنده 〕━━━╮\n" +
            "┃\n" +
            "┃ 👤 احمد بلال نوری\n" +
            "┃ 📍 ولایت غزنی 🇦🇫\n" +
            "┃\n" +
            "┃ 🛡️ فعال در حوزه هک اخلاقی\n" +
            "┃    و امنیت سایبری افغانستان\n" +
            "┃\n" +
            "┃ 💻 برنامه‌نویس و توسعه‌دهنده\n" +
            "┃ ⚡ متخصص ساخت ربات و برنامه‌نویسی\n" +
            "┃\n" +
            "┃ 👻 نام ربات:\n" +
            "┃ اح‍ـــمـــدبــݪاݪ نۅࢪی\n" +
            "┃\n" +
            "╰━━━━━━━━━━━━━━━━━━╯"
        });
        return;
      }
      // ===== CREATOR_COMMAND_END =====


      

// ===== IMAGE_AI_SYSTEM_START =====

async function downloadWhatsAppImage(imageMessage) {
  const stream = await downloadContentFromMessage(imageMessage, "image");
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function getQuotedImage(msg) {
  const directImage = msg.message?.imageMessage;
  if (directImage) return directImage;

  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    {};

  return context.quotedMessage?.imageMessage || null;
}

async function generateBotImage(prompt) {
  const result = await openaiClient.images.generate({
    model: "gpt-image-2.5-sunburst",
    prompt,
    size: "1024x1024",
    quality: "medium",
    output_format: "png",
    n: 1
  });

  const base64 = result?.data?.[0]?.b64_json;

  if (!base64) {
    throw new Error("تصویر تولید نشد");
  }

  return Buffer.from(base64, "base64");
}

async function editBotImage(imageBuffer, mimeType, prompt) {
  const form = new FormData();

  form.append("model", "gpt-image-2.5-sunburst");
  form.append("prompt", prompt);
  form.append(
    "image[]",
    new Blob([imageBuffer], {
      type: mimeType || "image/jpeg"
    }),
    "input.jpg"
  );

  form.append("size", "1024x1024");
  form.append("quality", "medium");
  form.append("output_format", "png");

  const response = await fetch(
    "https://api.openai.com/v1/images/edits",
    {
      method: "POST",
      headers: {
        Authorization:
          "Bearer " + process.env.OPENAI_API_KEY
      },
      body: form
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "خطا در ویرایش تصویر"
    );
  }

  const base64 = data?.data?.[0]?.b64_json;

  if (!base64) {
    throw new Error("تصویر ویرایش‌شده دریافت نشد");
  }

  return Buffer.from(base64, "base64");
}

// ===== تولید تصویر =====
if (
  lower.startsWith(".عکس ") ||
  lower.startsWith(".تصویر ") ||
  lower.startsWith(".ساخت ") ||
  lower.startsWith("عکس ") ||
  lower.startsWith("تصویر ")
) {
  const prompt = text
    .replace(/^\.عکس\s*/i, "")
    .replace(/^\.تصویر\s*/i, "")
    .replace(/^\.ساخت\s*/i, "")
    .replace(/^عکس\s*/i, "")
    .replace(/^تصویر\s*/i, "")
    .trim();

  if (!prompt) {
    await send(sock, jid, {
      text:
        "🎨 تولید تصویر\n\n" +
        "توضیح تصویر را بنویس.\n\n" +
        "مثال:\n" +
        ".عکس یک شهر آینده‌نگر در شب\n\n" +
        ".ساخت یک قلعه زیبا روی کوه"
    });
    return;
  }

  try {
    await send(sock, jid, {
      text: "🎨 در حال ساخت تصویر..."
    });

    const imageBuffer = await generateBotImage(prompt);

    await send(sock, jid, {
      image: imageBuffer,
      caption:
        "╭━━━〔 🎨 تصویر ساخته شد 〕━━━╮\n" +
        "┃\n" +
        "┃ ✦ درخواست:\n" +
        "┃ " + prompt + "\n" +
        "┃\n" +
        "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
    });
  } catch (e) {
    console.log("IMAGE GENERATION ERROR:", e.message);

    await send(sock, jid, {
      text:
        "❌ ساخت تصویر انجام نشد.\n" +
        "جزئیات: " + e.message
    });
  }

  return;
}

// ===== ادیت تصویر =====
if (
  lower.startsWith(".ادیت ") ||
  lower.startsWith(".ویرایش ") ||
  lower.startsWith(".تغییر ") ||
  lower.startsWith("ادیت ") ||
  lower.startsWith("ویرایش ")
) {
  const prompt = text
    .replace(/^\.ادیت\s*/i, "")
    .replace(/^\.ویرایش\s*/i, "")
    .replace(/^\.تغییر\s*/i, "")
    .replace(/^ادیت\s*/i, "")
    .replace(/^ویرایش\s*/i, "")
    .trim();

  const imageMessage = getQuotedImage(msg);

  if (!imageMessage) {
    await send(sock, jid, {
      text:
        "🖼️ برای ادیت عکس:\n\n" +
        "1️⃣ روی یک عکس Reply کن\n" +
        "2️⃣ بنویس:\n" +
        ".ادیت کارتونی کن\n\n" +
        "مثال‌های دیگر:\n" +
        ".ادیت پس‌زمینه را کوهستانی کن\n" +
        ".ادیت عکس را روشن‌تر کن\n" +
        ".ادیت عکس را سیاه و سفید کن"
    });
    return;
  }

  if (!prompt) {
    await send(sock, jid, {
      text:
        "❌ بگو چه تغییری در عکس می‌خواهی.\n\n" +
        "مثال:\n" +
        ".ادیت کارتونی کن"
    });
    return;
  }

  try {
    await send(sock, jid, {
      text: "🪄 در حال ادیت عکس..."
    });

    const imageBuffer =
      await downloadWhatsAppImage(imageMessage);

    const editedImage =
      await editBotImage(
        imageBuffer,
        imageMessage.mimetype || "image/jpeg",
        prompt
      );

    await send(sock, jid, {
      image: editedImage,
      caption:
        "╭━━━〔 🪄 عکس ویرایش شد 〕━━━╮\n" +
        "┃\n" +
        "┃ ✦ تغییر:\n" +
        "┃ " + prompt + "\n" +
        "┃\n" +
        "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
    });
  } catch (e) {
    console.log("IMAGE EDIT ERROR:", e.message);

    await send(sock, jid, {
      text:
        "❌ ادیت عکس انجام نشد.\n" +
        "جزئیات: " + e.message
    });
  }

  return;
}

// ===== IMAGE_AI_SYSTEM_END =====

// ===== CHATGPT_AI_SYSTEM_START =====
if (
  lower === ".ai" ||
  lower === ".هوش" ||
  lower.startsWith(".ai ") ||
  lower.startsWith(".هوش ")
) {
  const question = text
    .replace(/^\.ai\s*/i, "")
    .replace(/^\.هوش\s*/i, "")
    .trim();

  if (!question) {
    await send(sock, jid, {
      text:
        "👻 دستیار هوش مصنوعی\n\n" +
        "سؤالت را بعد از دستور بنویس.\n\n" +
        "مثال:\n" +
        ".ai سلام، خودت را معرفی کن\n\n" +
        "یا:\n" +
        ".هوش یک داستان کوتاه بنویس"
    });
    return;
  }

  try {
    await send(sock, jid, {
      text: "⏳ در حال فکر کردن..."
    });

    const answer = await askChatGPT(question);

    await send(sock, jid, {
      text:
        "╭━━━〔 👻 " + BOT_NAME + " 〕━━━╮\n" +
        "┃\n" +
        "┃ 🧠 پاسخ هوش مصنوعی\n" +
        "┃ ─────────────────\n" +
        "┃\n" +
        answer +
        "\n┃\n" +
        "╰━━━━━━━━━━━━━━━━━━╯"
    });
  } catch (e) {
    console.log("OPENAI ERROR:", e.message);

    await send(sock, jid, {
      text:
        "❌ اتصال به هوش مصنوعی با مشکل روبه‌رو شد.\n" +
        "لطفاً دوباره تلاش کن."
    });
  }

  return;
}
// ===== CHATGPT_AI_SYSTEM_END =====

// ===== MENU_HANDLER_START =====
      if (
        lower === ".menu" ||
        lower === "menu" ||
        lower === "/menu"
      ) {
        await send(sock, jid, {
          image: fs.readFileSync("./assets/menu.png"),
          caption: ahmadBilalMenu()
        });
        return;
      }
      // ===== MENU_HANDLER_END =====



    // ===== TIKTOK_DOWNLOADER_SYSTEM_START =====
if (
  lower === ".tiktok" ||
  lower === ".تیکتاک" ||
  lower.startsWith(".tiktok ") ||
  lower.startsWith(".تیکتاک ")
) {
  try {
    const match = text.match(
      /https?:\/\/[^\s<>"']*tiktok\.com[^\s<>"']*/i
    );

    let tiktokUrl = match
      ? match[0].replace(/[)\]}>،,؛.!؟]+$/g, "")
      : "";

    if (!tiktokUrl) {
      await send(sock, jid, {
        text:
          "❌ لینک TikTok پیدا نشد.\n\n" +
          "مثال:\n" +
          ".tiktok https://www.tiktok.com/@user/video/123456789"
      });
      return;
    }

    await send(sock, jid, {
      text: "⏳ در حال دریافت ویدیوی TikTok..."
    });

    console.log("========== TIKTOK ==========");
    console.log("TIKTOK INPUT:", tiktokUrl);

    // حل لینک کوتاه
    try {
      const r = await fetch(tiktokUrl, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36"
        }
      });

      if (r.url && /tiktok\.com/i.test(r.url)) {
        tiktokUrl = r.url.split("?")[0];
      }
    } catch (e) {
      console.log("TIKTOK RESOLVE ERROR:", e.message);
    }

    // حذف پارامترهای اشتراک
    tiktokUrl = tiktokUrl.split("?")[0];

    console.log("TIKTOK FINAL URL:", tiktokUrl);

    let videoUrl = "";
    let provider = "";

    // ==================================================
    // 1. DEPAY
    // ==================================================
    try {
      const api =
        "https://depay.cloud/api/downloader/tiktok?url=" +
        encodeURIComponent(tiktokUrl);

      const r = await fetch(api, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
          "Accept": "application/json,text/plain,*/*"
        }
      });

      const raw = await r.text();

      console.log("TIKTOK DEPAY STATUS:", r.status);
      console.log("TIKTOK DEPAY:", raw.slice(0, 3000));

      if (r.ok) {
        try {
          const data = JSON.parse(raw);

          const findUrl = obj => {
            if (!obj || typeof obj !== "object") return "";

            const keys = [
              "download_url",
              "downloadUrl",
              "video_url",
              "videoUrl",
              "no_watermark",
              "noWatermark",
              "url",
              "play"
            ];

            for (const key of keys) {
              if (
                typeof obj[key] === "string" &&
                /^https?:\/\//i.test(obj[key])
              ) {
                return obj[key];
              }
            }

            for (const value of Object.values(obj)) {
              if (value && typeof value === "object") {
                const found = findUrl(value);
                if (found) return found;
              }
            }

            return "";
          };

          videoUrl = findUrl(data);
        } catch {}
      }

      if (videoUrl) provider = "DEPAY";

    } catch (e) {
      console.log("TIKTOK DEPAY ERROR:", e.message);
    }

    // ==================================================
    // 2. SLBJS
    // ==================================================
    if (!videoUrl) {
      try {
        const api =
          "https://tdownv4.sl-bjs.workers.dev/?down=" +
          encodeURIComponent(tiktokUrl);

        const r = await fetch(api, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
            "Accept": "application/json,text/plain,*/*"
          }
        });

        const raw = await r.text();

        console.log("TIKTOK SLBJS STATUS:", r.status);
        console.log("TIKTOK SLBJS:", raw.slice(0, 3000));

        if (r.ok) {
          try {
            const data = JSON.parse(raw);

            videoUrl =
              data?.download_url ||
              data?.data?.download_url ||
              data?.video_url ||
              data?.data?.video_url ||
              data?.play ||
              data?.data?.play ||
              data?.hdplay ||
              data?.data?.hdplay ||
              "";
          } catch {}
        }

        if (videoUrl) provider = "SLBJS";

      } catch (e) {
        console.log("TIKTOK SLBJS ERROR:", e.message);
      }
    }

    // ==================================================
    // 3. GODOWNLOADER
    // ==================================================
    if (!videoUrl) {
      try {
        const api =
          "https://godownloader.com/api/tiktok-no-watermark-free?url=" +
          encodeURIComponent(tiktokUrl) +
          "&key=godownloader.com";

        const r = await fetch(api, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
            "Accept": "application/json,text/plain,*/*"
          }
        });

        const raw = await r.text();

        console.log(
          "TIKTOK GODOWNLOADER STATUS:",
          r.status
        );

        console.log(
          "TIKTOK GODOWNLOADER:",
          raw.slice(0, 3000)
        );

        if (r.ok) {
          try {
            const data = JSON.parse(raw);

            videoUrl =
              data?.video_url ||
              data?.download_url ||
              data?.data?.video_url ||
              data?.data?.download_url ||
              data?.url ||
              "";
          } catch {}
        }

        if (videoUrl) provider = "GODOWNLOADER";

      } catch (e) {
        console.log(
          "TIKTOK GODOWNLOADER ERROR:",
          e.message
        );
      }
    }

    if (
      !videoUrl ||
      !/^https?:\/\//i.test(videoUrl)
    ) {
      throw new Error(
        "هیچ سرویس دانلودی لینک مستقیم ویدیو نداد"
      );
    }

    console.log("TIKTOK PROVIDER:", provider);
    console.log(
      "TIKTOK VIDEO URL:",
      videoUrl.slice(0, 1000)
    );

    await sock.sendMessage(jid, {
      video: {
        url: videoUrl
      },
      mimetype: "video/mp4",
      fileName: "TikTok.mp4",
      caption: "🎬 TikTok\nبدون واترمارک"
    });

    console.log("TIKTOK SEND: OK");

  } catch (e) {
    console.log(
      "TIKTOK FINAL ERROR:",
      e.stack || e.message
    );

    await send(sock, jid, {
      text:
        "❌ دانلود TikTok انجام نشد.\n" +
        "سرویس دانلود برای این ویدیو پاسخ قابل استفاده نداد."
    });
  }

  return;
}
// ===== TIKTOK_DOWNLOADER_SYSTEM_END =====


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


      // ===== BIO COMMAND START =====
      if (lower === ".بیو" || lower === "بیو") {
        if (!isGroup) {
          await send(sock, jid, {
            text: "❌ دستور بیو فقط داخل گروپ قابل استفاده است."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text: "⛔ این دستور فقط برای مدیران گروپ است."
          });
          return;
        }

        const bios = [
          "🖤 کم حرف، پر فکر، آرام و بی‌نیاز از توضیح.",
          "🦅 تنها می‌روم، اما هدفم بزرگ است.",
          "👑 شخصیت را با رفتار می‌سازند، نه با حرف.",
          "🔥 ساده زندگی می‌کنم، اما معمولی نیستم.",
          "🌙 آرامش من از جایی شروع می‌شود که توقعم از مردم تمام می‌شود.",
          "💎 هر کسی ارزش واقعی تو را نمی‌فهمد.",
          "⚡ کمتر حرف می‌زنم، بیشتر عمل می‌کنم.",
          "🕊️ دلم آرامش می‌خواهد، نه توجه.",
          "🥀 بعضی سکوت‌ها هزار حرف دارند.",
          "✨ خودت باش؛ نسخه اصلی همیشه خاص‌تر است.",
          "🖤 نه مغرور، فقط برای هر کسی در دسترس نیستم.",
          "👑 احترام می‌دهم، احترام می‌خواهم.",
          "🔥 من برای جلب توجه نیامده‌ام؛ برای ساختن آمده‌ام.",
          "🌙 شب آرام است، وقتی قلبت آرام باشد.",
          "🦅 پرواز را از آدم‌های زمین‌گیر یاد نگرفتم.",
          "💫 زندگی ادامه دارد؛ حتی وقتی بعضی‌ها نمی‌مانند.",
          "🥀 بعضی آدم‌ها خاطره می‌شوند، نه همراه.",
          "🖤 قلبم ساده است، اما اعتمادم ارزان نیست.",
          "⚔️ آرامم، اما ضعیف نیستم.",
          "👑 خودت را کوچک نکن تا دیگران احساس بزرگی کنند.",
          "🔥 شکست پایان نیست؛ یک درس گران‌قیمت است.",
          "🌿 آرام باش، همه چیز به وقتش درست می‌شود.",
          "💎 ارزش خودت را بدان.",
          "🦅 به جای توضیح دادن، خودت را ثابت کن.",
          "🖤 سکوت من جواب خیلی چیزهاست.",
          "✨ بعضی فاصله‌ها برای آرامش لازم‌اند.",
          "🌙 دلم یک زندگی ساده و یک قلب آرام می‌خواهد.",
          "🔥 رویاهایم بزرگ‌تر از ترس‌هایم هستند.",
          "👑 من خودم را با کسی مقایسه نمی‌کنم.",
          "🕊️ آزاد باش، حتی اگر تنها باشی.",
          "🥀 همه لبخندها نشانه خوشحالی نیستند.",
          "💫 هنوز برای بهتر شدن دیر نشده.",
          "⚡ وقت طلاست؛ برای هر کسی خرجش نکن.",
          "🖤 اعتماد یک بار شکسته شود، مثل اول نمی‌شود.",
          "🦅 بلند پرواز کن، حتی اگر کسی باورت نکند.",
          "🔥 منفی‌ها را رها کن، آینده را بساز.",
          "🌙 آرامش از درون می‌آید، نه از آدم‌ها.",
          "👑 کسی که خودش را شناخته، محتاج تأیید نیست.",
          "💎 خاص بودن یعنی خودت بودن.",
          "🇦🇫 از خاک افغانستان، با آرزوهای بزرگ.",
          "🇦🇫 دل افغانی، غیرت افغانی، آرزوی بزرگ.",
          "🇦🇫 ساده‌ام، اما ریشه‌دار.",
          "🇦🇫 افتخار به ریشه‌ها، امید به فردا.",
          "🇦🇫 وطن در قلب، آینده در دست.",
          "❤️ عشق زیباست وقتی دو طرف واقعی باشند.",
          "🌹 یک قلب واقعی، هزار حرف ناگفته دارد.",
          "🥀 دوست داشتن همیشه به معنی ماندن نیست.",
          "❤️ بعضی آدم‌ها خودِ آرامش‌اند.",
          "🌹 اگر واقعی باشی، ارزش ماندن داری.",
          "💔 بعضی خاطره‌ها هیچ‌وقت پیر نمی‌شوند.",
          "🥀 دل شکسته هم دوباره لبخند می‌زند.",
          "❤️ عشق با حرف ثابت نمی‌شود؛ با رفتار ثابت می‌شود.",
          "🌙 دلت را به هر کسی نسپار.",
          "💔 بعضی رفتن‌ها شروع یک زندگی تازه‌اند.",
          "😂 زندگی کوتاه است، زیاد جدی نگیر.",
          "🤣 من و مشکلاتم هنوز در حال مذاکره‌ایم.",
          "😂 لبخند بزن؛ شاید اینترنتت دوباره وصل شود.",
          "😎 من مشکلی ندارم، مشکلات با من مشکل دارند.",
          "🤣 زندگی بدون خنده مثل چای بدون قند است.",
          "😂 اگر زندگی لیمو داد، چای بساز.",
          "😎 قیافه آرام، ذهن شلوغ.",
          "😂 من دیر نمی‌کنم، زمان زود می‌رسد.",
          "🤣 امروز هم زنده ماندیم؛ موفقیت بزرگی است.",
          "😎 کم آنلاین، زیاد درگیر زندگی.",
          "🌧️ بعضی روزها فقط باید گذشت.",
          "🥀 خسته‌ام، اما تسلیم نیستم.",
          "🌙 گاهی سکوت بهترین جواب است.",
          "🖤 لبخند می‌زنم، حتی وقتی دلم خسته است.",
          "🌧️ هر باران یک داستان دارد.",
          "🥀 همه زخم‌ها دیده نمی‌شوند.",
          "🕊️ امیدوارم فردا بهتر از امروز باشد.",
          "🌙 آرام آرام، همه چیز می‌گذرد.",
          "💭 بعضی فکرها را فقط شب می‌فهمد.",
          "🖤 قوی بودن همیشه به معنی بی‌درد بودن نیست.",
          "🔥 هر صبح یک فرصت تازه است.",
          "🌅 فردا می‌تواند شروع دوباره باشد.",
          "💪 سختی امروز، تجربه فرداست.",
          "🚀 قدم کوچک هم اگر ادامه‌دار باشد، بزرگ می‌شود.",
          "🔥 رویا بدون تلاش فقط یک خیال است.",
          "💎 خودت را بساز؛ دنیا خودش متوجه می‌شود.",
          "🦅 زمین خوردن بخشی از پرواز است.",
          "⚡ امروز بهتر از دیروز.",
          "🌱 آهسته، اما رو به جلو.",
          "🏆 موفقیت از عادت‌های کوچک ساخته می‌شود.",
          "🔥 تسلیم شدن گزینه من نیست.",
          "💪 به خودت باور داشته باش.",
          "🌟 آینده برای کسانی است که امروز تلاش می‌کنند.",
          "👑 عزت نفس، بهترین لباس انسان است.",
          "🖤 هر کسی دوست تو نیست؛ و اشکالی هم ندارد.",
          "🦅 دوستان کم، اما واقعی.",
          "💎 کیفیت آدم‌ها مهم‌تر از تعدادشان است.",
          "🤝 رفاقت با معرفت معنا پیدا می‌کند.",
          "🖤 رفیق واقعی در سختی شناخته می‌شود.",
          "🔥 آدم واقعی پشتت حرف نمی‌زند؛ کنارت می‌ایستد.",
          "🤝 وفاداری از هزار حرف باارزش‌تر است.",
          "👑 احترام متقابل، اساس هر رابطه است.",
          "🕊️ آدم‌های خوب را قدر بدان.",
          "💫 بعضی رفاقت‌ها عمرشان از خیلی رابطه‌ها بیشتر است.",
          "😎 من همانم که هستم، نه آنی که دیگران می‌خواهند.",
          "🖤 توضیح اضافه برای کسی که نمی‌خواهد بفهمد، لازم نیست.",
          "👑 ارزش من با نظر دیگران تغییر نمی‌کند.",
          "🔥 شخصیت من قابل کپی نیست.",
          "🦅 من دنبال رقابت نیستم؛ دنبال پیشرفت خودم هستم.",
          "💎 خاص بودن نیازی به اعلام کردن ندارد.",
          "😎 ساده باش، اما ساده گرفته نشو.",
          "⚡ سکوت گاهی قدرت است.",
          "🖤 هر لبخندی را به معنی رضایت ندان.",
          "👑 خودت را دست کم نگیر.",
          "🌙 زندگی را برای خودت زندگی کن.",
          "💫 دنیا همیشه طبق نقشه ما پیش نمی‌رود.",
          "🌿 بعضی چیزها ارزش نگرانی ندارند.",
          "🕊️ رها کن چیزهایی را که آرامشت را می‌گیرند.",
          "🌙 آرامش از انتخاب‌های درست می‌آید.",
          "💎 هر چیزی قیمت دارد، اما آرامش ارزش دارد.",
          "🔥 گذشته درس است، نه خانه.",
          "🦅 آینده را با امروزت بساز.",
          "✨ یک روز خوب از یک فکر خوب شروع می‌شود.",
          "🌱 تغییر از خودت شروع می‌شود.",
          "💪 بهانه کمتر، تلاش بیشتر.",
          "🚀 هدف داشته باش و حرکت کن.",
          "🏆 آهسته برو، ولی متوقف نشو.",
          "🔥 هیچ‌کس به جای تو زندگی‌ات را نمی‌سازد.",
          "💫 خودت بهترین پروژه زندگی خودت هستی.",
          "🌟 امید را از دست نده.",
          "🖤 آرامش را با هیچ چیزی معامله نکن.",
          "🌙 بعضی جواب‌ها فقط با گذشت زمان پیدا می‌شوند.",
          "🥀 هر خداحافظی پایان دنیا نیست.",
          "🕊️ گاهی رها کردن، خودش یک پیروزی است.",
          "💭 آدم‌ها می‌آیند و می‌روند؛ درس‌ها می‌مانند.",
          "❤️ قلب خوب داشته باش، حتی اگر دنیا سخت باشد.",
          "🌹 مهربانی هنوز هم ارزش دارد.",
          "🖤 خوب بودن ضعف نیست.",
          "👑 با همه محترم، با خودت صادق.",
          "🔥 خودت را برای کسی تغییر نده.",
          "🦅 راه خودت را برو.",
          "💎 چیزی که برایت ارزش دارد، حفظش کن.",
          "🌿 ساده زندگی کن، عمیق فکر کن.",
          "🌙 کمتر توقع، بیشتر آرامش.",
          "✨ زندگی را از نو بساز.",
          "🇦🇫 دل ما از کوه‌های افغانستان محکم‌تر.",
          "🇦🇫 خاک ما، ریشه ما، افتخار ما.",
          "🇦🇫 از افغانستان با قلبی پر از امید.",
          "🇦🇫 افغان بودن یعنی ریشه داشتن.",
          "🇦🇫 برای فردای بهتر تلاش می‌کنیم.",
          "🖤 نه دنبال شهرت، نه دنبال تأیید.",
          "👑 من خودم را انتخاب کرده‌ام.",
          "🔥 هنوز داستان من تمام نشده.",
          "🦅 بهترین فصل زندگی شاید هنوز نرسیده باشد.",
          "💫 هر روز یک شروع تازه است.",
          "🌙 شب می‌گذرد، صبح می‌رسد.",
          "🌅 امید همیشه یک راه پیدا می‌کند.",
          "❤️ زندگی با محبت زیباتر است.",
          "🥀 دل قوی باش؛ همه چیز می‌گذرد."
        ];

        const bio =
          bios[Math.floor(Math.random() * bios.length)];

        await send(sock, jid, {
          text:
            "╭━━━〔 📝 بیو 〕━━━╮\n" +
            "┃\n" +
            "┃ " + bio + "\n" +
            "┃\n" +
            "╰━━━━━━━━━━━━━━╯"
        });

        return;
      }
      // ===== BIO COMMAND END =====
      

      // ===== OPS_COMMAND_START =====
      if (lower === ".ops") {
        if (!isGroup) {
          await send(sock, jid, {
            text: "❌ این دستور فقط داخل گروپ قابل استفاده است."
          });
          return;
        }

        try {
          const opsMetadata = metadata || await sock.groupMetadata(jid);
          const members = opsMetadata.participants || [];
          const adminCount = members.filter(p =>
            p.admin === "admin" ||
            p.admin === "superadmin" ||
            p.admin === "owner"
          ).length;

          await send(sock, jid, {
            text:
              "╭━━━〔 👻 OPS CENTER 〕━━━╮\n" +
              "┃\n" +
              "┃ 👥 اعضای گروپ: " + members.length + "\n" +
              "┃ 👑 مدیران: " + adminCount + "\n" +
              "┃\n" +
              "┃ 🛡️ امنیت\n" +
              "┃ 🔗 ضد لینک: " + (settings.antilink ? "🟢 فعال" : "🔴 خاموش") + "\n" +
              "┃ 🌊 ضد فلود: 🟢 فعال\n" +
              "┃ 👋 خوشامدگویی: " + (settings.welcome ? "🟢 فعال" : "🔴 خاموش") + "\n" +
              "┃\n" +
              "┃ ⚙️ ربات: 🟢 ONLINE\n" +
              "┃ 🧠 AI: 🟢 READY\n" +
              "┃\n" +
              "╰━━━━━━━━━━━━━━━━━━╯"
          });
        } catch (e) {
          console.log("OPS Error:", e.message);
          await send(sock, jid, {
            text: "❌ دریافت اطلاعات گروپ ناموفق بود."
          });
        }
        return;
      }
      // ===== OPS_COMMAND_END =====

      // ===== PROFILE_COMMAND_START =====
      if (lower.startsWith(".profile")) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "❌ این دستور فقط داخل گروپ قابل استفاده است."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text: "⛔ فقط مدیران گروپ می‌توانند پروفایل اعضا را ببینند."
          });
          return;
        }

        const profileMentions = getMentions(msg);
        const profileQuoted =
          msg.message?.extendedTextMessage?.contextInfo?.participant;

        const profileTarget =
          profileMentions?.[0] ||
          profileQuoted ||
          sender;

        try {
          const profileMetadata =
            metadata || await sock.groupMetadata(jid);

          const profileStats = getUserStats(profileTarget);
          const profileName =
            await getMemberName(sock, jid, profileTarget);

          const profileAdmin =
            isAdmin(profileMetadata, profileTarget);

          await send(sock, jid, {
            text:
              "╭━━━〔 👻 MEMBER PROFILE 〕━━━╮\n" +
              "┃\n" +
              "┃ 👤 نام: " + profileName + "\n" +
              "┃ 🆔 وضعیت: " +
                (profileAdmin ? "👑 مدیر" : "👤 عضو") + "\n" +
              "┃\n" +
              "┃ 💬 تعداد پیام: " +
                (profileStats?.messages || 0) + "\n" +
              "┃\n" +
              "╰━━━━━━━━━━━━━━━━━━━━╯"
          });
        } catch (e) {
          console.log("PROFILE Error:", e.message);
          await send(sock, jid, {
            text: "❌ دریافت پروفایل ناموفق بود."
          });
        }
        return;
      }
      // ===== PROFILE_COMMAND_END =====


        

// ===== STATS_ALIAS_FIX =====
function getStatsAliases(user, metadata) {
  const aliases = new Set();

  const add = (v) => {
    if (!v) return;
    const c = cleanJid(v);
    if (c) aliases.add(c);
  };

  add(user);

  const target = String(user || "");
  const participant = (metadata?.participants || []).find(p => {
    return [
      p?.id,
      p?.jid,
      p?.phoneNumber,
      p?.pn,
      p?.participant,
      p?.participantAlt,
      p?.lid
    ].filter(Boolean).some(v => sameUser(v, target));
  });

  if (participant) {
    add(participant.id);
    add(participant.jid);
    add(participant.phoneNumber);
    add(participant.pn);
    add(participant.participant);
    add(participant.participantAlt);
    add(participant.lid);
  }

  return [...aliases];
}

function getBestStats(user, metadata) {
  const aliases = getStatsAliases(user, metadata);

  let best = {
    total: 0,
    days: {},
    key: ""
  };

  for (const key of aliases) {
    const data = chatStats[key];
    if (!data) continue;

    const total = Number(data.total || 0);

    if (total > Number(best.total || 0)) {
      best = {
        total,
        days: data.days || {},
        key
      };
    }
  }

  return best;
}

function getBestChatRank(user, metadata) {
  const best = getBestStats(user, metadata);
  if (!best.key) return "-";
  return getChatRank(best.key);
}
// ===== STATS_ALIAS_FIX =====


// ===== DEBUG_STATS_TARGET =====
async function debugStatsTarget(sock, msg, jid, metadata) {
  const sender =
    msg.key?.participant ||
    msg.participant ||
    msg.key?.remoteJid ||
    "";

  const participant = (metadata?.participants || []).find(p =>
    [
      p?.id,
      p?.jid,
      p?.phoneNumber,
      p?.pn,
      p?.participant,
      p?.participantAlt,
      p?.lid
    ].filter(Boolean).some(v => sameUser(v, sender))
  );

  const fields = participant ? {
    id: participant.id || "",
    jid: participant.jid || "",
    phoneNumber: participant.phoneNumber || "",
    pn: participant.pn || "",
    lid: participant.lid || "",
    participant: participant.participant || "",
    participantAlt: participant.participantAlt || "",
    notify: participant.notify || "",
    name: participant.name || ""
  } : {};

  const aliases = participant
    ? [
        participant.id,
        participant.jid,
        participant.phoneNumber,
        participant.pn,
        participant.participant,
        participant.participantAlt,
        participant.lid
      ].filter(Boolean).map(cleanJid)
    : [cleanJid(sender)];

  const uniqueAliases = [...new Set(aliases)];

  let statsLines = [];
  for (const key of uniqueAliases) {
    const data = chatStats[key];
    statsLines.push(
      key + " => " + (data ? Number(data.total || 0) : "وجود ندارد")
    );
  }

  await send(sock, jid, {
    text:
      "╭━━〔 🔬 بررسی آمار 〕━━╮\n" +
      "┃ فرستنده: " + sender + "\n" +
      "┃\n" +
      "┃ 🆔 id: " + (fields.id || "-") + "\n" +
      "┃ 📱 jid: " + (fields.jid || "-") + "\n" +
      "┃ 📞 phone: " + (fields.phoneNumber || "-") + "\n" +
      "┃ 📞 pn: " + (fields.pn || "-") + "\n" +
      "┃ 🏷️ lid: " + (fields.lid || "-") + "\n" +
      "┃\n" +
      "┣━━〔 🔢 کلیدهای آمار 〕━━┫\n" +
      statsLines.map(x => "┃ " + x).join("\n") +
      "\n╰━━━━━━━━━━━━━━╯"
  });
}
// ===== DEBUG_STATS_TARGET =====

// ===== ACTIVE_COMMAND_START =====
if (lower === ".debugmembers") {
  if (!isGroup) {
    await send(sock, jid, {
      text: "❌ فقط داخل گروپ."
    });
    return;
  }

  try {
    const md =
      metadata ||
      await sock.groupMetadata(jid);

    let out =
      "╭━━〔 🔎 بررسی اعضا 〕━━╮\n";

    for (const p of md.participants || []) {
      out +=
        "\n👤 name: " +
        String(
          p.notify ||
          p.name ||
          p.vname ||
          ""
        ) +
        "\n🆔 id: " +
        String(p.id || "") +
        "\n📱 jid: " +
        String(p.jid || "") +
        "\n📞 phoneNumber: " +
        String(p.phoneNumber || "") +
        "\n📞 pn: " +
        String(p.pn || "") +
        "\n🏷️ lid: " +
        String(p.lid || "") +
        "\n";
    }

    out +=
      "\n╰━━━━━━━━━━━━━━╯";

    await send(sock, jid, {
      text: out
    });
  } catch (e) {
    await send(sock, jid, {
      text:
        "❌ خطا:\n" +
        e.message
    });
  }

  return;
}

if (lower === ".active") {
  if (!isGroup) {
    await send(sock, jid, {
      text: "❌ این دستور فقط داخل گروپ قابل استفاده است."
    });
    return;
  }

  try {
    const activeUsers = getTopChatUsers(10);
    const activeMetadata =
      metadata || await sock.groupMetadata(jid);

    const now = new Date();

    const timeParts = new Intl.DateTimeFormat("fa-AF", {
      timeZone: "Asia/Kabul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).formatToParts(now);

    const getPart = type =>
      timeParts.find(x => x.type === type)?.value || "";

    const exactTime =
      getPart("hour") + ":" +
      getPart("minute") + ":" +
      getPart("second") + " " +
      getPart("dayPeriod");

    const today = getKabulDate(0);
    const yesterday = getKabulDate(-1);

    const getRealMember = (user) => {
      const target = String(user || "");

      return activeMetadata?.participants?.find(p => {
        const ids = [
          p.id,
          p.jid,
          p.phoneNumber,
          p.pn,
          p.participant,
          p.participantAlt
        ].filter(Boolean);

        return ids.some(id => sameUser(id, target));
      });
    };

    const getRealPhone = (participant, fallback) => {
      const candidates = [
        participant?.phoneNumber,
        participant?.pn,
        participant?.jid,
        participant?.participant,
        participant?.participantAlt
      ].filter(Boolean);

      for (const value of candidates) {
        const number = String(value)
          .split("@")[0]
          .split(":")[0]
          .replace(/\D/g, "");

        // فقط شماره واقعی، نه LID
        if (
          number &&
          number.length >= 8 &&
          number.length <= 15
        ) {
          return number;
        }
      }

      return String(fallback || "")
        .split("@")[0]
        .split(":")[0]
        .replace(/\D/g, "");
    };

    const getDisplayName = (participant, fallback) => {
      const name = String(
        participant?.notify ||
        participant?.name ||
        participant?.vname ||
        participant?.verifiedName ||
        ""
      ).trim();

      if (name) return name;

      // فقط شماره واقعی واتساپ؛ هرگز LID نمایش داده نشود
      const phone =
        participant?.phoneNumber ||
        participant?.pn ||
        participant?.jid;

      const number = String(phone || "")
        .split("@")[0]
        .split(":")[0]
        .replace(/\D/g, "");

      if (number && number.length >= 8 && number.length <= 15) {
        return number;
      }

      return "";
    };

    const totalGroupMessages =
      activeMetadata?.participants?.reduce(
        (sum, p) => {
          const ids = [
            p.id,
            p.jid,
            p.phoneNumber,
            p.pn
          ].filter(Boolean);

          let userId = "";

          for (const id of ids) {
            const cleaned = cleanJid(id);
            if (chatStats[cleaned]) {
              userId = cleaned;
              break;
            }
          }

          return sum + Number(
            userId ? chatStats[userId]?.total || 0 : 0
          );
        },
        0
      ) || 0;

    const todayTotal =
      activeMetadata?.participants?.reduce(
        (sum, p) => {
          const ids = [
            p.id,
            p.jid,
            p.phoneNumber,
            p.pn
          ].filter(Boolean);

          let userId = "";

          for (const id of ids) {
            const cleaned = cleanJid(id);
            if (chatStats[cleaned]) {
              userId = cleaned;
              break;
            }
          }

          return sum + Number(
            userId
              ? chatStats[userId]?.days?.[today] || 0
              : 0
          );
        },
        0
      ) || 0;

    const yesterdayTotal =
      activeMetadata?.participants?.reduce(
        (sum, p) => {
          const ids = [
            p.id,
            p.jid,
            p.phoneNumber,
            p.pn
          ].filter(Boolean);

          let userId = "";

          for (const id of ids) {
            const cleaned = cleanJid(id);
            if (chatStats[cleaned]) {
              userId = cleaned;
              break;
            }
          }

          return sum + Number(
            userId
              ? chatStats[userId]?.days?.[yesterday] || 0
              : 0
          );
        },
        0
      ) || 0;

    const mentions = [];
    const lines = [];

    for (let i = 0; i < activeUsers.length; i++) {
      const item = activeUsers[i];

      const participant =
        getRealMember(item.user);

      const displayName =
        getDisplayName(
          participant,
          ""
        );

      // JID واقعی برای تگ
      const mentionJid =
        participant?.jid ||
        participant?.phoneNumber ||
        participant?.pn ||
        participant?.participant;

      if (mentionJid) {
        mentions.push(mentionJid);
      }

      const todayCount =
        Number(
          chatStats[item.user]?.days?.[today] || 0
        );

      const yesterdayCount =
        Number(
          chatStats[item.user]?.days?.[yesterday] || 0
        );

      const medal =
        i === 0 ? "🥇" :
        i === 1 ? "🥈" :
        i === 2 ? "🥉" :
        "🔹";

      lines.push(
        "┃ " + medal + " @" + displayName +
        "\n┃ ├ 💬 چت: " + Number(item.total || 0) +
        "\n┃ ├ 🟢 امروز: " + todayCount +
        "\n┃ └ 🌙 دیروز: " + yesterdayCount
      );
    }

    if (!lines.length) {
      lines.push(
        "┃\n┃ 📭 هنوز فعالیتی ثبت نشده است."
      );
    }

    const text =
      "╭━━━〔 👻 گروپ اکتیف 〕━━━╮\n" +
      "┃\n" +
      "┃ ✦ مرکز فعالیت واقعی گروپ\n" +
      "┃ ✦ آمار بر اساس پیام‌های واقعی ربات\n" +
      "┃\n" +
      "┣━━〔 🏆 ده عضو فعال 〕━━━━┫\n" +
      lines.join("\n┃\n") +
      "\n┃\n" +
      "┣━━〔 📊 آمار گروپ 〕━━━━━━┫\n" +
      "┃ 👥 اعضای گروپ: " +
      Number(
        activeMetadata?.participants?.length || 0
      ) +
      "\n" +
      "┃ 💬 مجموع چت ثبت‌شده: " +
      totalGroupMessages +
      "\n" +
      "┃ 🟢 فعالیت امروز: " +
      todayTotal +
      "\n" +
      "┃ 🌙 فعالیت دیروز: " +
      yesterdayTotal +
      "\n" +
      "┃ 📚 اعضای دارای فعالیت: " +
      activeUsers.length +
      "\n" +
      "┃ 📞 مدت کال: واقعی و ثبت‌شده\n" +
      "┃\n" +
      "┣━━〔 🕐 زمان گزارش 〕━━━━━━┫\n" +
      "┃ 📅 تاریخ: " + today +
      "\n" +
      "┃ 🕐 ساعت دقیق: " + exactTime +
      "\n" +
      "┃ 🇦🇫 منطقه: افغانستان\n" +
      "┃\n" +
      "╰━━━━━━━━━━━━━━━━━━━━╯";

    await send(sock, jid, {
      text,
      mentions
    });

  } catch (e) {
    console.log("ACTIVE Error:", e.message);

    await send(sock, jid, {
      text:
        "❌ دریافت آمار گروپ ناموفق بود.\n" +
        "جزئیات: " + e.message
    });
  }

  return;
}
// ===== ACTIVE_COMMAND_END =====

// ===== RAGBAR_SYSTEM_START =====
        // رگبار: ۶ پیام قبلی حذف، پیام هفتم باقی می‌ماند و اخطار می‌دهد

        if (
          isGroup &&
          !msg.key.fromMe &&
          !senderIsAdmin
        ) {
          const messageIsVoice =
            !!msg.message?.audioMessage?.ptt ||
            !!msg.message?.audioMessage ||
            !!msg.message?.voiceMessage;

          if (!messageIsVoice) {
            if (!globalThis.__ragbar) {
              globalThis.__ragbar = {};
            }

            const ragbarKey =
              jid + ":" + cleanJid(sender);

            const ragbarText =
              String(lower)
                .replace(/\\u200c/g, "")
                .replace(/\s+/g, " ")
                .trim();

            if (ragbarText) {
              let data =
                globalThis.__ragbar[ragbarKey];

              if (
                !data ||
                data.text !== ragbarText
              ) {
                data = {
                  text: ragbarText,
                  count: 0,
                  messages: []
                };

                globalThis.__ragbar[ragbarKey] = data;
              }

              data.count += 1;
              data.messages.push(msg.key);

              console.log(
                "RAGBAR:",
                cleanJid(sender),
                data.count,
                "/ 7"
              );

              // پیام‌های ۱ تا ۶ فعلاً حذف نمی‌شوند
              if (data.count < 7) {
                // پیام‌های ۱ تا ۶ باقی می‌مانند و پردازش ادامه پیدا می‌کند.
              }

              // پیام هفتم
              if (data.count === 7) {

                // فقط ۶ پیام قبلی حذف شوند
                const oldMessages =
                  data.messages.slice(0, 6);

                for (const oldKey of oldMessages) {
                  try {
                    await sock.sendMessage(jid, {
                      delete: oldKey
                    });

                    console.log(
                      "RAGBAR OLD MESSAGE DELETED"
                    );
                  } catch (e) {
                    console.log(
                      "RAGBAR OLD DELETE ERROR:",
                      e.message
                    );
                  }
                }

                if (!globalThis.__warnings) {
                  globalThis.__warnings = {};
                }

                const warningKey =
                  jid + ":" + cleanJid(sender);

                globalThis.__warnings[warningKey] =
                  Number(
                    globalThis.__warnings[warningKey] || 0
                  ) + 1;

                const warningCount =
                  globalThis.__warnings[warningKey];

                try {
                  await sock.sendMessage(jid, {
                    text:
                      "╭━━━〔 ⚠️ اخطار رگبار 〕━━━╮\n" +
                      "┃ 👤 @" + cleanJid(sender) + "\n" +
                      "┃ 🌧️ یک پیام را ۷ بار تکرار کردی\n" +
                      "┃ 🗑️ ۶ پیام قبلی حذف شد\n" +
                      "┃ 🔥 اخطار: " + warningCount + " / 7\n" +
                      "╰━━━━━━━━━━━━━━━━━━━━╯",
                    mentions: [sender]
                  });

                  console.log(
                    "RAGBAR WARNING:",
                    warningCount
                  );
                } catch (e) {
                  console.log(
                    "RAGBAR WARNING ERROR:",
                    e.message
                  );
                }

                // پیام هفتم باقی می‌ماند
                // عضو در اینجا حذف نمی‌شود
                delete globalThis.__ragbar[ragbarKey];

                return;
              }
            }
          }
        }
        // ===== RAGBAR_SYSTEM_END =====

        // ===== GAME_CENTER_SYSTEM_START =====
        // 🎮 اح‍ـــمـــدبــݪاݪ | بازی‌های گروهی به زبان دری

        if (isGroup && !msg.key.fromMe) {
          if (!globalThis.__ahmadGames) {
            globalThis.__ahmadGames = {};
          }

          const gameUser = cleanJid(sender);

          if (!gameUser) return;

          if (!globalThis.__ahmadGames[gameUser]) {
            globalThis.__ahmadGames[gameUser] = {
              پول: 1000,
              امتیاز: 0,
              بازی: 0
            };
          }

          const player = globalThis.__ahmadGames[gameUser];

          const sendGame = async (text, extra = {}) => {
            try {
              await sock.sendMessage(jid, {
                text,
                ...extra
              });
            } catch (e) {
              console.log("GAME ERROR:", e.message);
            }
          };

          // فهرست بازی‌ها
          if (
            lower === ".بازی" ||
            lower === "بازی" ||
            lower === ".گیم"
          ) {
            return await sendGame(
              "╭━━━〔 🎮 اح‍ـــمـــدبــݪاݪ 〕━━━╮\n" +
              "┃ 🎯 .حدس       حدس عدد\n" +
              "┃ 🧠 .معلومات   سوال معلومات عمومی\n" +
              "┃ ⚡ .سرعت      بازی سرعت\n" +
              "┃ 🧩 .معما      معمای دری\n" +
              "┃ ✊ .سنگ       سنگ، کاغذ، قیچی\n" +
              "┃ 🎲 .تاس       پرتاب تاس\n" +
              "┃ 🪙 .سکه       شیر یا خط\n" +
              "┃ 🎰 .شانس      بازی شانس\n" +
              "┃ 🃏 .کارت      کارت تصادفی\n" +
              "┃ 💣 .مین       بازی مین\n" +
              "┃ 🕵️ .مافیا     شروع مافیا\n" +
              "┃ 💰 .پول       پول شما\n" +
              "┃ 💼 .کار       کار و درآمد\n" +
              "┃ 🏆 .قهرمانان  جدول امتیاز\n" +
              "╰━━━━━━━━━━━━━━━━━━╯"
            );
          }

          // پول
          if (
            lower === ".پول" ||
            lower === ".موجودی"
          ) {
            return await sendGame(
              "╭━━〔 💰 حساب اح‍ـــمـــدبــݪاݪ 〕━━╮\n" +
              "┃ 👤 @" + gameUser + "\n" +
              "┃ 💵 پول: " + player.پول + "\n" +
              "┃ 🏆 امتیاز: " + player.امتیاز + "\n" +
              "╰━━━━━━━━━━━━━━━━╯",
              { mentions: [sender] }
            );
          }

          // کار
          if (lower === ".کار") {
            const jobs = [
              "در دکان کار کردی",
              "در بازار کار کردی",
              "یک کار ساختمانی انجام دادی",
              "برای یک مشتری کار کردی",
              "در خانه به یک نفر کمک کردی"
            ];

            const earned =
              100 + Math.floor(Math.random() * 401);

            const job =
              jobs[Math.floor(Math.random() * jobs.length)];

            player.پول += earned;
            player.امتیاز += 1;
            player.بازی += 1;

            return await sendGame(
              "💼 " + job + "\n\n" +
              "💵 درآمد: +" + earned + "\n" +
              "💰 پول فعلی: " + player.پول + "\n" +
              "🏆 امتیاز: +" + 1
            );
          }

          // حدس عدد
          if (lower.startsWith(".حدس")) {
            const arg = lower.replace(".حدس", "").trim();

            if (!arg) {
              const n =
                1 + Math.floor(Math.random() * 10);

              globalThis.__ahmadGames[gameUser].guess = n;

              return await sendGame(
                "🎯 یک عدد بین ۱ تا ۱۰ در ذهن من است.\n" +
                "حدس خود را بفرست؛ مثال:\n" +
                ".حدس ۷"
              );
            }

            const guess = Number(arg);
            const target =
              globalThis.__ahmadGames[gameUser].guess;

            if (!target || !Number.isInteger(guess)) {
              return await sendGame(
                "❌ نخست `.حدس` را بزن، سپس عدد خود را بفرست."
              );
            }

            if (guess === target) {
              player.پول += 300;
              player.امتیاز += 5;
              delete player.guess;

              return await sendGame(
                "🎉 درست حدس زدی!\n" +
                "💵 جایزه: +300\n" +
                "🏆 امتیاز: +5"
              );
            }

            if (guess < target) {
              return await sendGame("⬆️ عدد بزرگ‌تر است.");
            }

            return await sendGame("⬇️ عدد کوچک‌تر است.");
          }

          // تاس
          if (lower === ".تاس") {
            const n =
              1 + Math.floor(Math.random() * 6);

            player.بازی += 1;
            player.امتیاز += n;

            return await sendGame(
              "🎲 تاس انداخته شد: **" + n + "**\n" +
              "🏆 امتیاز: +" + n
            );
          }

          // سکه
          if (lower === ".سکه") {
            const result =
              Math.random() < 0.5 ? "شیر" : "خط";

            player.بازی += 1;
            player.امتیاز += 2;

            return await sendGame(
              "🪙 نتیجه سکه: **" + result + "**\n" +
              "🏆 امتیاز: +2"
            );
          }

          // سنگ کاغذ قیچی
          if (
            lower === ".سنگ" ||
            lower === ".کاغذ" ||
            lower === ".قیچی"
          ) {
            const choices = [
              ".سنگ",
              ".کاغذ",
              ".قیچی"
            ];

            const bot =
              choices[Math.floor(Math.random() * 3)];

            const user = lower;

            let result = "مساوی شد.";
            let reward = 1;

            if (
              (user === ".سنگ" && bot === ".قیچی") ||
              (user === ".کاغذ" && bot === ".سنگ") ||
              (user === ".قیچی" && bot === ".کاغذ")
            ) {
              result = "🎉 تو بردی!";
              reward = 5;
              player.پول += 100;
            } else if (user !== bot) {
              result = "😄 این بار من بردم.";
            }

            player.امتیاز += reward;
            player.بازی += 1;

            const names = {
              ".سنگ": "سنگ",
              ".کاغذ": "کاغذ",
              ".قیچی": "قیچی"
            };

            return await sendGame(
              "✊ انتخاب تو: " + names[user] + "\n" +
              "👻 انتخاب من: " + names[bot] + "\n\n" +
              result + "\n" +
              "🏆 امتیاز: +" + reward
            );
          }

          // شانس
          if (
            lower === ".شانس" ||
            lower === ".اسلات"
          ) {
            const icons = ["🍎", "🍋", "⭐", "💎", "7️⃣"];

            const a =
              icons[Math.floor(Math.random() * icons.length)];
            const b =
              icons[Math.floor(Math.random() * icons.length)];
            const c =
              icons[Math.floor(Math.random() * icons.length)];

            let reward = 0;

            if (a === b && b === c) {
              reward = 500;
            } else if (a === b || b === c || a === c) {
              reward = 100;
            }

            player.پول += reward;
            player.بازی += 1;

            return await sendGame(
              "🎰 " + a + " | " + b + " | " + c + "\n\n" +
              (reward
                ? "🎉 برنده شدی!\n💵 جایزه: +" + reward
                : "😅 این بار چیزی نبردی.")
            );
          }

          // کارت
          if (lower === ".کارت") {
            const suits = ["دل", "خشت", "پیک", "گشنیز"];
            const values = [
              "آس", "۲", "۳", "۴", "۵",
              "۶", "۷", "۸", "۹", "۱۰",
              "سرباز", "بی‌بی", "شاه"
            ];

            const suit =
              suits[Math.floor(Math.random() * suits.length)];

            const value =
              values[Math.floor(Math.random() * values.length)];

            player.امتیاز += 2;

            return await sendGame(
              "🃏 کارت تو:\n" +
              "「" + value + " " + suit + "」\n\n" +
              "🏆 امتیاز: +2"
            );
          }

          // معلومات عمومی
          if (
            lower === ".معلومات" ||
            lower === ".سوال"
          ) {
            const questions = [
              {
                q: "پایتخت افغانستان چیست؟",
                a: "کابل"
              },
              {
                q: "بزرگ‌ترین سیاره منظومه شمسی کدام است؟",
                a: "مشتری"
              },
              {
                q: "آب در چند درجه سانتی‌گراد یخ می‌زند؟",
                a: "۰"
              },
              {
                q: "چند روز در یک هفته وجود دارد؟",
                a: "۷"
              }
            ];

            const item =
              questions[
                Math.floor(Math.random() * questions.length)
              ];

            player.quiz = item.a;

            return await sendGame(
              "🧠 سوال:\n" +
              item.q + "\n\n" +
              "برای پاسخ بنویس:\n" +
              ".جواب پاسخ"
            );
          }

          // پاسخ سوال
          if (lower.startsWith(".جواب")) {
            const answer =
              lower.replace(".جواب", "").trim();

            if (!player.quiz) {
              return await sendGame(
                "❌ فعلاً سوالی فعال نیست."
              );
            }

            if (answer === player.quiz.toLowerCase()) {
              player.پول += 200;
              player.امتیاز += 5;
              delete player.quiz;

              return await sendGame(
                "🎉 پاسخ درست بود!\n" +
                "💵 جایزه: +200\n" +
                "🏆 امتیاز: +5"
              );
            }

            return await sendGame(
              "❌ پاسخ نادرست است."
            );
          }

          // معما
          if (lower === ".معما") {
            const riddles = [
              {
                q: "آن چیست که دندان دارد ولی غذا نمی‌خورد؟",
                a: "شانه"
              },
              {
                q: "آن چیست که هرچه بیشتر از آن برداری، بزرگ‌تر می‌شود؟",
                a: "چاله"
              },
              {
                q: "آن چیست که پا دارد ولی راه نمی‌رود؟",
                a: "میز"
              }
            ];

            const item =
              riddles[
                Math.floor(Math.random() * riddles.length)
              ];

            player.riddle = item.a;

            return await sendGame(
              "🧩 معما:\n" +
              item.q + "\n\n" +
              "پاسخ:\n" +
              ".جواب پاسخ"
            );
          }

          // قهرمانان
          if (
            lower === ".قهرمانان" ||
            lower === ".رتبه"
          ) {
            const list =
              Object.entries(globalThis.__ahmadGames)
                .sort(
                  (a, b) =>
                    Number(b[1].امتیاز || 0) -
                    Number(a[1].امتیاز || 0)
                )
                .slice(0, 10);

            let text =
              "╭━━━〔 🏆 قهرمانان اح‍ـــمـــدبــݪاݪ 〕━━━╮\n";

            list.forEach((item, index) => {
              text +=
                "┃ " +
                (index + 1) +
                ". @" +
                item[0] +
                " — " +
                (item[1].امتیاز || 0) +
                " امتیاز\n";
            });

            text +=
              "╰━━━━━━━━━━━━━━━━━━━━╯";

            return await sendGame(text, {
              mentions: list.map(item => item[0] + "@s.whatsapp.net")
            });
          }

          // سرعت
          if (lower === ".سرعت") {
            const words = [
              "احمد",
              "کابل",
              "افغانستان",
              "دوستی",
              "اح‍ـــمـــدبــݪاݪ"
            ];

            const word =
              words[Math.floor(Math.random() * words.length)];

            player.speed = word.toLowerCase();

            return await sendGame(
              "⚡ اولین کسی که این کلمه را بفرستد برنده است:\n\n" +
              "👉 " + word
            );
          }

          // مین
          if (lower.startsWith(".مین")) {
            const cells = 9;
            const mine =
              Math.floor(Math.random() * cells) + 1;

            const arg =
              lower.replace(".مین", "").trim();

            if (!arg) {
              return await sendGame(
                "💣 یک خانه از ۱ تا ۹ را انتخاب کن.\n" +
                "مثال: `.مین ۵`"
              );
            }

            const pick = Number(arg);

            if (
              !Number.isInteger(pick) ||
              pick < 1 ||
              pick > 9
            ) {
              return await sendGame(
                "❌ خانه باید بین ۱ تا ۹ باشد."
              );
            }

            player.بازی += 1;

            if (pick === mine) {
              player.پول = Math.max(
                0,
                player.پول - 100
              );

              return await sendGame(
                "💥 مین منفجر شد!\n" +
                "💸 ۱۰۰ پول از دست دادی."
              );
            }

            player.پول += 150;
            player.امتیاز += 3;

            return await sendGame(
              "🛡️ خانه امن بود!\n" +
              "💵 جایزه: +150\n" +
              "🏆 امتیاز: +3"
            );
          }

          // مافیا
          if (lower === ".مافیا") {
            const roles = [
              "مافیا",
              "پولیس",
              "دکتر",
              "شهروند"
            ];

            const role =
              roles[Math.floor(Math.random() * roles.length)];

            return await sendGame(
              "🕵️ بازی مافیا آغاز شد!\n\n" +
              "نقش خصوصی تو:\n" +
              "🔐 " + role + "\n\n" +
              "برای اجرای بازی گروهی، اعضا باید `.مافیا` را بزنند."
            );
          }
        }

        // ===== GAME_CENTER_SYSTEM_END =====


      // ===== NEW_FEATURES_V3_START =====

      // 🧹 پاکسازی
      if (
        lower === ".clear" ||
        lower.startsWith(".clear ")
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "❌ این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text: "❌ فقط مدیر گروه می‌تواند پاکسازی کند."
          });
          return;
        }

        if (!botIsAdmin) {
          await send(sock, jid, {
            text:
              "❌ اح‍ـــمـــدبــݪاݪ نۅࢪی باید مدیر گروه باشد."
          });
          return;
        }

        let count = parseInt(
          text.replace(/^\.clear\s*/i, "").trim(),
          10
        );

        if (!Number.isFinite(count)) count = 10;
        count = Math.max(1, Math.min(count, 50));

        await send(sock, jid, {
          text:
            "🧹 پاکسازی آماده است.\n" +
            "تعداد درخواست‌شده: " + count + "\n\n" +
            "⚠️ واتساپ حذف پیام‌های قدیمی را محدود می‌کند."
        });

        return;
      }

      // ⚙️ پیام خودکار
      globalThis.__ahmadAutoGroups =
        globalThis.__ahmadAutoGroups || new Set();

      if (
        lower === ".auto on" ||
        lower === ".auto off"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "❌ این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text: "❌ فقط مدیر گروه می‌تواند این قابلیت را تغییر دهد."
          });
          return;
        }

        if (lower === ".auto on") {
          globalThis.__ahmadAutoGroups.add(jid);

          await send(sock, jid, {
            text:
              "╭━━━〔 ⚙️ پیام خودکار 〕━━━╮\n" +
              "┃\n" +
              "┃ ✅ فعال شد\n" +
              "┃ ⏰ زمان‌بندی: هر ۳۰ دقیقه\n" +
              "┃\n" +
              "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
          });
        } else {
          globalThis.__ahmadAutoGroups.delete(jid);

          await send(sock, jid, {
            text: "❌ پیام خودکار این گروه خاموش شد."
          });
        }

        return;
      }

      // 🌐 مترجم
      if (lower.startsWith(".ترجمه ")) {
        const translateText = text
          .replace(/^\.ترجمه\s*/i, "")
          .trim();

        if (!translateText) {
          await send(sock, jid, {
            text:
              "🌐 مترجم هوشمند\n\n" +
              "مثال:\n" +
              ".ترجمه Hello my friend"
          });
          return;
        }

        try {
          await send(sock, jid, {
            text: "🌐 در حال ترجمه..."
          });

          const result = await openaiClient.responses.create({
            model: "gpt-5.6-luna",
            instructions:
              "زبان متن را تشخیص بده. " +
              "اگر متن فارسی یا دری بود به انگلیسی روان ترجمه کن. " +
              "اگر انگلیسی یا زبان دیگری بود به فارسی/دری روان ترجمه کن. " +
              "فقط ترجمه را برگردان.",
            input: translateText
          });

          await send(sock, jid, {
            text:
              "╭━━━〔 🌐 مترجم هوشمند 〕━━━╮\n" +
              "┃\n" +
              "┃ " + (result.output_text || "ترجمه دریافت نشد.") +
              "\n┃\n" +
              "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
          });
        } catch (e) {
          console.log("TRANSLATE ERROR:", e.message);

          await send(sock, jid, {
            text:
              "❌ ترجمه انجام نشد.\n" +
              "لطفاً دوباره تلاش کن."
          });
        }

        return;
      }

      // 🚨 گزارش
      if (
        lower === ".report" ||
        lower.startsWith(".report ")
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "❌ این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        const ctx =
          msg.message?.extendedTextMessage?.contextInfo ||
          {};

        const mentions = [
          ...getMentions(msg),
          ...(msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []),
          ...(msg.message?.imageMessage?.contextInfo?.mentionedJid || []),
          ...(msg.message?.videoMessage?.contextInfo?.mentionedJid || []),
          ...(msg.message?.documentMessage?.contextInfo?.mentionedJid || [])
        ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

    console.log("\n========== IDI DEBUG ==========");
    console.log("SENDER:", sender);
    console.log("PUSH NAME:", msg.pushName || "");
    console.log("PARTICIPANTS:");

    for (const p of (metadata?.participants || [])) {
      console.log(JSON.stringify({
        id: p?.id || "",
        jid: p?.jid || "",
        phoneNumber: p?.phoneNumber || "",
        pn: p?.pn || "",
        lid: p?.lid || "",
        participant: p?.participant || "",
        participantAlt: p?.participantAlt || "",
        notify: p?.notify || "",
        name: p?.name || ""
      }));
    }

    console.log("CHAT STATS KEYS:", Object.keys(chatStats));
    console.log("================================\n");
        const target =
          mentions[0] ||
          ctx.participant ||
          null;

        const reason = text
          .replace(/^\.report\s*/i, "")
          .trim();

        console.log(
          "GROUP REPORT:",
          JSON.stringify({
            group: jid,
            reporter: sender,
            target: target,
            reason: reason
          })
        );

        await send(sock, jid, {
          text:
            "╭━━━〔 🚨 گزارش گروه 〕━━━╮\n" +
            "┃\n" +
            "┃ 👤 گزارش‌دهنده: " +
            (msg.pushName || cleanJid(sender)) +
            "\n" +
            "┃ 🎯 هدف: " +
            (target ? cleanJid(target) : "مشخص نشده") +
            "\n" +
            "┃ 📝 دلیل: " +
            (reason || "بدون توضیح") +
            "\n" +
            "┃\n" +
            "┃ ✅ گزارش ثبت شد.\n" +
            "┃\n" +
            "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
        });

        return;
      }

      // 🧠 ChatGPT پیشرفته
      if (
        lower.startsWith(".ai+") ||
        lower.startsWith(".هوش+")
      ) {
        const question = text
          .replace(/^\.ai\+\s*/i, "")
          .replace(/^\.هوش\+\s*/i, "")
          .trim();

        if (!question) {
          await send(sock, jid, {
            text:
              "🧠 هوش مصنوعی پیشرفته\n\n" +
              "مثال:\n" +
              ".ai+ یک برنامه مطالعه برای صنف دهم بساز"
          });
          return;
        }

        try {
          await send(sock, jid, {
            text: "🧠 در حال پردازش..."
          });

          const result = await openaiClient.responses.create({
            model: "gpt-5.6-luna",
            instructions:
              "تو دستیار پیشرفته فارسی/دری هستی. " +
              "در آموزش، برنامه‌ریزی، خلاصه‌سازی، تحلیل، ترجمه، " +
              "کدنویسی و حل مسئله کمک کن. " +
              "پاسخ دقیق، کاربردی، منظم و نسبتاً کوتاه بده.",
            input: question
          });

          await send(sock, jid, {
            text:
              "╭━━━〔 🧠 هوش پیشرفته 〕━━━╮\n" +
              "┃\n" +
              "┃ " + (result.output_text || "پاسخی دریافت نشد.") +
              "\n┃\n" +
              "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
          });
        } catch (e) {
          console.log("ADVANCED AI ERROR:", e.message);

          await send(sock, jid, {
            text: "❌ هوش مصنوعی پیشرفته در دسترس نیست."
          });
        }

        return;
      }

      // ===== NEW_FEATURES_V3_END =====

        // ===== BADWORD_SYSTEM_START =====
        if (isGroup && !msg.key.fromMe && !senderIsAdmin) {
          const badWords = [
            "کونی",
            "کون",
            "کوس",
            "کوسی",
            "کیر",
            "کیر",
            "فایشه",
            "حرامی",
            "خایه"
          ];

          const cleanText = String(lower)
            .replace(/ي/g, "ی")
            .replace(/ى/g, "ی")
            .replace(/ك/g, "ک")
            .replace(/\u200c/g, "")
            .replace(/\s+/g, " ")
            .trim();

          const badWord = badWords.find(word =>
            cleanText.includes(word)
          );

          if (badWord) {
            console.log(
              "BADWORD DETECTED:",
              badWord,
              "FROM:",
              sender
            );

            try {
              await sock.sendMessage(jid, {
                delete: msg.key
              });
              console.log("BADWORD MESSAGE DELETED");
            } catch (e) {
              console.log(
                "BADWORD DELETE ERROR:",
                e.message
              );
            }

            if (!globalThis.__warnings) {
              globalThis.__warnings = {};
            }

            const warningKey =
              jid + ":" + cleanJid(sender);

            globalThis.__warnings[warningKey] =
              Number(globalThis.__warnings[warningKey] || 0) + 1;

            const warningCount =
              globalThis.__warnings[warningKey];

            try {
              await sock.sendMessage(jid, {
                text:
                  "╭━━━〔 ⚠️ اخطار 〕━━━╮\n" +
                  "┃ 👤 @" + cleanJid(sender) + "\n" +
                  "┃ 🚫 فحش و الفاظ نامناسب ممنوع است\n" +
                  "┃ 🔥 اخطار: " +
                  warningCount +
                  " / 7\n" +
                  "╰━━━━━━━━━━━━━━━━━━╯",
                mentions: [sender]
              });

              console.log(
                "WARNING SENT:",
                warningCount
              );
            } catch (e) {
              console.log(
                "WARNING SEND ERROR:",
                e.message
              );
            }

            if (warningCount >= 7 && botIsAdmin) {
              try {
                await sock.groupParticipantsUpdate(
                  jid,
                  [sender],
                  "remove"
                );

                console.log(
                  "USER REMOVED AFTER 7 WARNINGS"
                );

                delete globalThis.__warnings[warningKey];
              } catch (e) {
                console.log(
                  "AUTO REMOVE ERROR:",
                  e.message
                );
              }
            }

            return;
          }
        }
        // ===== BADWORD_SYSTEM_END =====


      if (
        lower === "امار چت" ||
        lower === "آمار چت"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text:
              "این دستور فقط در گروپ قابل استفاده است."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text:
              "این دستور فقط برای مدیران گروپ است."
          });
          return;
        }

        const top =
          getTopChatUsers(10);

        const memberCount =
          metadata?.participants?.length || 0;

        const now = new Date();

          const solarParts = new Intl.DateTimeFormat("en-US-u-ca-persian", { timeZone: "Asia/Kabul", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());

          const solarYear = solarParts.find(p => p.type === "year")?.value || "";
          const solarMonth = Number(solarParts.find(p => p.type === "month")?.value || 0);
          const solarDay = solarParts.find(p => p.type === "day")?.value || "";

          const solarMonths = ["", "حمل", "ثور", "جوزا", "سرطان", "اسد", "سنبله", "میزان", "عقرب", "قوس", "جدی", "دلو", "حوت"];

          const dateText = solarDay + " " + (solarMonths[solarMonth] || "") + " " + solarYear;

          const timeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kabul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
}).formatToParts(new Date());

const hh = timeParts.find(p => p.type === "hour")?.value || "00";
const mm = timeParts.find(p => p.type === "minute")?.value || "00";
const ss = timeParts.find(p => p.type === "second")?.value || "00";

const toFaDigits = value =>
  String(value).replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

const timeText =
  toFaDigits(hh) + ":" +
  toFaDigits(mm) + ":" +
  toFaDigits(ss);

        const medals = [
          "🥇",
          "🥈",
          "🥉",
          "➃",
          "➄",
          "➅",
          "➆",
          "➇",
          "➈",
          "➉"
        ];

        const groupName =
          metadata?.subject || "گروپ ما";

        let result =
          "╭━━━〔 آمار فعالیت گروپ 〕━━━╮\n" +
          "┃  " + groupName + "\n" +
          "┃  👥 تعداد اعضا : " + memberCount + "\n" +
          "┃  📅 " + dateText + "\n" +
          "┃  🕐 " + timeText + " | کابل افغانستان\n" +
          "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +
          "🏆 نفرات فعال گروپ\n" +
          "━━━━━━━━━━━━━━━━━━\n";

        if (top.length === 0) {

          result +=
            "هنوز آماری از اعضای گروپ ثبت نشده است.";

        } else {

          for (let i = 0; i < top.length; i++) {

            const user = top[i];

            const name =
              getMemberName(
                metadata,
                user.user
              );

            result +=
              "• رتـبه" +
              medals[i] +
              " : " +
              name +
              " | " +
              user.total +
              " بار\n";
          }
        }

        await send(sock, jid, {
          text: result
        });

        return;
      }


      
      if (
        lower === "آیدی" ||
        lower === "ایدی"
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط داخل گروپ کار می‌کند."
          });
          return;
        }

        const context =
          msg.message?.extendedTextMessage?.contextInfo ||
          msg.message?.imageMessage?.contextInfo ||
          msg.message?.videoMessage?.contextInfo ||
          msg.message?.documentMessage?.contextInfo ||
          msg.message?.audioMessage?.contextInfo ||
          msg.message?.stickerMessage?.contextInfo ||
          {};

        const mentions = getMentions(msg);

        const replyIds = [
          context.participant,
          context.participantAlt,
          context.participantPn,
          context.senderPn,
          context.senderLid
        ].filter(Boolean);

        const targetIds = [
          ...mentions,
          ...replyIds
        ];

        let target = sender;

        if (targetIds.length > 0) {
          const otherTarget = targetIds.find(x => {
            return cleanJid(x) !== cleanJid(sender);
          });

          if (otherTarget) {
            if (!senderIsAdmin) {
              await send(sock, jid, {
                text:
                  "فقط ادمین گروپ می‌تواند آمار شخص دیگری را ببیند."
              });
              return;
            }

            target = otherTarget;
          }
        }

        // ===== پیدا کردن عضو واقعی گروپ =====
        let participant = null;

        const searchIds = [
          target,
          ...targetIds,
          ...replyIds
        ].filter(Boolean);

        for (const searchId of searchIds) {
          participant = metadata?.participants?.find(p => {
            const ids = [
              p.id,
              p.lid,
              p.jid,
              p.phoneNumber,
              p.pn,
              p.participant,
              p.participantAlt
            ].filter(Boolean);

            return ids.some(id => {
              return String(id) === String(searchId);
            });
          });

          if (participant) break;
        }

        // اگر با تطبیق مستقیم پیدا نشد، تطبیق عددی را امتحان کن
        if (!participant) {
          for (const searchId of searchIds) {
            participant = metadata?.participants?.find(p => {
              const ids = [
                p.id,
                p.lid,
                p.jid,
                p.phoneNumber,
                p.pn,
                p.participant,
                p.participantAlt
              ].filter(Boolean);

              return ids.some(id => {
                return cleanJid(id) === cleanJid(searchId);
              });
            });

            if (participant) break;
          }
        }

        // ===== تمام شناسه‌های این شخص =====
        const candidateIds = [];

        const addCandidate = value => {
          if (!value) return;

          const id = cleanJid(value);

          if (!id) return;

          if (!candidateIds.includes(id)) {
            candidateIds.push(id);
          }
        };

        addCandidate(target);
        addCandidate(sender);

        for (const id of targetIds) {
          addCandidate(id);
        }

        for (const id of replyIds) {
          addCandidate(id);
        }

        if (participant) {
          addCandidate(participant.id);
          addCandidate(participant.lid);
          addCandidate(participant.jid);
          addCandidate(participant.phoneNumber);
          addCandidate(participant.pn);
          addCandidate(participant.participant);
          addCandidate(participant.participantAlt);
        }

        // ===== پیدا کردن رکورد آماری =====
        let statsKey = null;
        let stats = null;

        for (const id of candidateIds) {
          if (chatStats[id]) {
            statsKey = id;
            stats = chatStats[id];
            break;
          }
        }

        // اگر اولین شناسه آمار نداشت، رکورد با بیشترین آمار را پیدا کن
        if (!stats) {
          let bestTotal = -1;

          for (const id of candidateIds) {
            const saved = chatStats[id];

            if (!saved) continue;

            const total = Number(saved.total || 0);

            if (total > bestTotal) {
              bestTotal = total;
              statsKey = id;
              stats = saved;
            }
          }
        }

        if (!stats) {
          stats = {
            total: 0,
            days: {}
          };
        }

        // ===== JID واقعی برای عکس =====
        let profileJid = target || sender;

        if (participant) {
          profileJid =
            participant.jid ||
            participant.phoneNumber ||
            participant.pn ||
            participant.id ||
            profileJid;
        }

        // ===== شماره واقعی برای نمایش =====
        let phoneNumber = "";

        if (participant) {
          phoneNumber = cleanJid(
            participant.jid ||
            participant.phoneNumber ||
            participant.pn ||
            ""
          );
        }

        if (!phoneNumber) {
          for (const id of candidateIds) {
            if (chatStats[id]) {
              phoneNumber = id;
              break;
            }
          }
        }

        // ===== نام واقعی =====
        let name = "";

        if (participant) {
          name = String(
            participant.notify ||
            participant.name ||
            participant.vname ||
            participant.verifiedName ||
            ""
          ).trim();
        }

        if (!name) {
          name = phoneNumber || "نامشخص";
        }

        const today =
          getKabulDate(0);

        const yesterday =
          getKabulDate(-1);

        const todayCount =
          Number(stats.days?.[today] || 0);

        const yesterdayCount =
          Number(stats.days?.[yesterday] || 0);

        const totalCount =
          Number(stats.total || 0);

        // رتبه بر اساس همان کلید آماری که واقعاً پیدا شد
        const rank =
          statsKey
            ? getChatRank(statsKey)
            : "-";

        const profileText =
          "╭━━━〔 پروفایل فعالیت 〕━━━╮\n" +
          "┃ 👤 نام : " + name + "\n" +
          "┃ 📱 شماره : " + (phoneNumber || "نامشخص") + "\n" +
          "┣━━━━━━━━━━━━━━━━━━\n" +
          "┃ 📅 امروز : " + todayCount + " پیام\n" +
          "┃ 🕐 دیروز : " + yesterdayCount + " پیام\n" +
          "┃ 💬 مجموع : " + totalCount + " پیام\n" +
          "┃ 🏆 رتبه : " + rank + "\n" +
          "╰━━━━━━━━━━━━━━━━━━╯";

        let photoSent = false;

        const photoTargets = [
          profileJid,
          participant?.id,
          participant?.jid,
          participant?.phoneNumber,
          target,
          sender
        ].filter(Boolean);

        for (const photoTarget of photoTargets) {
          if (photoSent) break;

          try {
            const imageUrl =
              await sock.profilePictureUrl(
                photoTarget,
                "image"
              );

            if (!imageUrl) continue;

            const response =
              await fetch(imageUrl);

            if (!response.ok) continue;

            const imageBuffer =
              Buffer.from(
                await response.arrayBuffer()
              );

            await sock.sendMessage(jid, {
              image: imageBuffer,
              caption: profileText
            });

            photoSent = true;
          } catch (e) {
            console.log(
              "Profile Photo Error:",
              e.message
            );
          }
        }

        if (!photoSent) {
          try {
            const { createCanvas } =
              require("canvas");

            const canvas =
              createCanvas(1000, 1000);

            const ctx =
              canvas.getContext("2d");

            ctx.fillStyle = "#111111";
            ctx.fillRect(0, 0, 1000, 1000);

            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "bold 70px sans-serif";

            ctx.fillText(
              "The King Of",
              500,
              430
            );

            ctx.fillText(
              "Hack Belal",
              500,
              530
            );

            const imageBuffer =
              canvas.toBuffer("image/png");

            await sock.sendMessage(jid, {
              image: imageBuffer,
              caption: profileText
            });

            photoSent = true;
          } catch (e) {
            console.log(
              "Fallback Image Error:",
              e.message
            );

            await send(sock, jid, {
              text: profileText
            });
          }
        }

        return;
      }

      // ===== ضد لینک: هشدار اول، اخراج در لینک دوم =====
      if (
        isGroup &&
        settings.antilink &&
        !msg.key.fromMe &&
        hasLink(text)
      ) {
        if (senderIsAdmin) return;

        globalThis.__antiLinkWarnings =
          globalThis.__antiLinkWarnings || new Map();

        const warningKey =
          jid + ":" + cleanJid(sender);

        const warningCount =
          Number(globalThis.__antiLinkWarnings.get(warningKey) || 0);

        // هر پیام لینک حذف شود
        try {
          await sock.sendMessage(jid, {
            delete: msg.key
          });
        } catch (e) {
          console.log("Delete Link Error:", e.message);
        }

        // لینک اول = هشدار
        if (warningCount === 0) {
          globalThis.__antiLinkWarnings.set(warningKey, 1);

          await send(sock, jid, {
            text:
              "⚠️ هشدار اول!\n\n" +
              "ارسال لینک در این گروپ ممنوع است.\n" +
              "🔴 لینک بعدی بفرستی، از گروپ اخراج می‌شوی."
          });

          return;
        }

        // لینک دوم = حذف + اخراج
        globalThis.__antiLinkWarnings.delete(warningKey);

        if (botIsAdmin) {
          try {
            await sock.groupParticipantsUpdate(
              jid,
              [sender],
              "remove"
            );

            await send(sock, jid, {
              text:
                "🚫 لینک دوم ارسال شد.\n" +
                "پیام حذف شد و فرستنده از گروپ اخراج گردید."
            });
          } catch (e) {
            await send(sock, jid, {
              text:
                "🚫 لینک حذف شد، اما اخراج فرستنده انجام نشد."
            });
          }
        } else {
          await send(sock, jid, {
            text:
              "🚫 لینک دوم ارسال شد و پیام حذف شد.\n" +
              "برای اخراج فرستنده، اح‍ـــمـــدبــݪاݪ باید ادمین گروپ باشد."
          });
        }

        return;
      }

      


// واکنش به پیام ادمین قبل از اجرای هر دستور
      if (
        isAdmin(metadata, sender) &&
        (
          lower.startsWith(".") ||
          lower.startsWith("/") ||
          lower === "pair"
        )
      ) {
        try {
          await sock.sendMessage(jid, {
            react: {
              text: "👍",
              key: msg.key
            }
          });
        } catch (e) {
          console.log("Reaction Error:", e.message);
        }
      }

      if (
        lower === ".pair" ||
        lower === "/pair" ||
        lower === "pair"
      ) {
        try { await createFacePair(sock, sender); } catch (e) { console.log("PAIR ERROR:", e); await send(sock, jid, { text: "خطای Pair: " + (e.message || e) }); }
        return;
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
        lower.startsWith(".movie ") ||
        lower.startsWith("/movie ")
      ) {
        const movieName = text.slice(text.indexOf(" ") + 1).trim();

        if (!movieName) {
          await send(sock, jid, {
            text:
              "🎬 نام فیلم را بعد از دستور بنویس.\n\n" +
              "مثال:\n.movie Titanic"
          });
          return;
        }

        try {
          const url =
            "https://fa.wikipedia.org/w/api.php?action=query" +
            "&prop=extracts|info" +
            "&exintro=1&explaintext=1&inprop=url" +
            "&redirects=1&format=json&origin=*" +
            "&titles=" + encodeURIComponent(movieName);

          const response = await fetch(url);
          const json = await response.json();
          const pages = json?.query?.pages || {};
          const data = Object.values(pages)[0];

          if (!data || data.missing || !data.extract) {
            await send(sock, jid, {
              text:
                "❌ فیلم مورد نظر پیدا نشد.\n\n" +
                "لطفاً نام فیلم را دقیق‌تر به فارسی یا انگلیسی بنویس."
            });
            return;
          }

          let title = String(data.title || movieName).trim();
          let summary = String(data.extract || "").trim();

          if (summary.length > 1200) {
            summary = summary.slice(0, 1200).trim() + "…";
          }

          await send(sock, jid, {
            text:
              "╭━━━〔 🎬 معرفی فیلم 〕━━━╮\n" +
              "┃\n" +
              "┃ 🎞️ نام فیلم: " + title + "\n" +
              "┃\n" +
              "┃ 📖 معلومات:\n" +
              "┃ " + summary.replace(/\n/g, "\n┃ ") + "\n" +
              "┃\n" +
              "╰━━━〔 " + BOT_NAME + " 〕━━━╯"
          });

        } catch (e) {
          console.log("Movie Error:", e.message);

          await send(sock, jid, {
            text:
              "❌ در دریافت معلومات فیلم مشکل پیش آمد.\n" +
              "لطفاً دوباره تلاش کن."
          });
        }

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
            ".pair\n" +
            ".ping\n" +
            ".movie نام فیلم\n" +
            "🧠 .ai سوال\n" +
            "🧠 .هوش سوال\n" +            "🧹 .clear 50\n" +
            "⚙️ .auto on/off\n" +
            "🌐 .ترجمه متن\n" +
            "🚨 .report دلیل\n" +
            "🧠 .ai+ سوال\n" +
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
          text: `╭━━〔 👻 اح‍ـــمـــدبــݪاݪ نۅࢪی 〕━━╮
┃
┃ ✦ راهنمای دستورات ✦
┃
┃ ⚡ اصلی
┃ ◈ .pair — ساخت QR اختصاصی
┃ ◈ .ping — تست ربات
┃ ◈ .movie نام فیلم — معرفی فیلم
┃ ◈ .عکس متن — ساخت تصویر با هوش مصنوعی
┃ ◈ .ادیت متن — ادیت عکس با Reply
┃ ◈ .ai سوال — گفتگو با هوش مصنوعی
┃ ◈ .هوش سوال — پاسخ فارسی هوش مصنوعی                              ┃ ◈ .clear 50 — پاکسازی پیام‌ها
┃ ◈ .auto on/off — پیام خودکار
┃ ◈ .ترجمه متن — مترجم هوشمند
┃ ◈ .report — ثبت گزارش داخلی
┃ ◈ .ai+ سوال — هوش مصنوعی پیشرفته
┃ ◈ .menu — منو
┃
┃ 👥 گروه
┃ ◈ .rules — قوانین
┃ ◈ .info — معلومات گروه
┃ ◈ .groupinfo — معلومات گروه
┃ ◈ .admins — مدیران
┃ ◈ .owner — مالک گروه
┃
┃ 📢 تگ
┃ ◈ .tagall — تگ همه
┃ ◈ .hidetag — تگ مخفی
┃ ◈ .tagadmin — تگ مدیران
┃
┃ 🛡️ محافظت
┃ ◈ .antilink on/off — ضد لینک
┃ ◈ .welcome on/off — خوش‌آمدگویی
┃ ◈ .bye on/off — پیام خروج
┃ ◈ .settings — تنظیمات
┃
┃ 👑 مدیریت
┃ ◈ .remove — حذف عضو تگ‌شده
┃ ◈ .kick — حذف عضو تگ‌شده
┃ ◈ .promote — مدیر کردن
┃ ◈ .demote — گرفتن مدیریت
┃ ◈ .mute — بستن گروه
┃ ◈ .unmute — باز کردن گروه
┃
┃ 🔗 ویژه
┃ ◈ .linkphoto — عکس و لینک گروه
┃
╰━━〔 👻 اح‍ـــمـــدبــݪاݪ نۅࢪی 〕━━╯`
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
            "╭━━━〔 👻 قوانین گروه 〕━━━╮\n" +
            "┃\n" +
            "┃ 🛡️ قوانین اصلی\n" +
            "┃ ─────────────────\n" +
            "┃ ❶ احترام به تمام اعضا\n" +
            "┃\n" +
            "┃ ❷ رعایت قوانین گروه\n" +
            "┃\n" +
            "┃ ❸ ارسال لینک بدون اجازه ممنوع\n" +
            "┃\n" +
            "┃ ─────────────────\n" +
            "┃ 👑 " + BOT_NAME + "\n" +
            "┃\n" +
            "╰━━〔 با احترام به همه 〕━━╯"
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
              p.admin === "superadmin" ||
              p.admin === "owner"
          );

        const requester =
          participants.find(p => {
            const ids = [
              p.id,
              p.jid,
              p.phoneNumber,
              p.participant,
              p.participantAlt,
              p.pn,
              p.lid
            ].filter(Boolean);

            return ids.some(
              id => sameUser(id, sender)
            );
          });

        let personName =
          requester?.notify ||
          requester?.name ||
          requester?.vname ||
          requester?.verifiedName ||
          "";

        if (!String(personName).trim()) {
          const phoneFields = [
            requester?.phoneNumber,
            requester?.pn,
            requester?.jid,
            requester?.participant,
            requester?.participantAlt,
            sender
          ].filter(Boolean);

          for (const value of phoneFields) {
            const str = String(value);

            if (str.endsWith("@s.whatsapp.net")) {
              const number =
                str.split("@")[0].replace(/\D/g, "");

              if (number) {
                personName = "+" + number;
                break;
              }
            }
          }
        }

        if (!String(personName).trim()) {
          personName = "شماره موجود نیست";
        }

        await send(sock, jid, {
          text:
            "╭━━━〔 👻 معلومات گروه 〕━━━╮\n" +
            "┃\n" +
            "┃ 🏷️ نام گروه : " +
            (metadata?.subject || "نامشخص") +
            "\n" +
            "┃ 👥 اعضا : " +
            participants.length +
            "\n" +
            "┃ 👑 مدیران : " +
            admins.length +
            "\n" +
            "┃\n" +
            "┃ 👤 درخواست‌کننده :\n" +
            "┃ " +
            personName +
            "\n" +
            "┃\n" +
            "╰━━━━━━━━━━━━━━━━━━╯"
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
              p.admin === "superadmin" ||
              p.admin === "owner"
          ) || [];

        const mentions =
          admins
            .map(p =>
              p.id ||
              p.jid ||
              p.participant ||
              p.phoneNumber
            )
            .filter(Boolean);

        let out =
          "╭━━━〔 👑 مدیران گروه 〕━━━╮\n" +
          "┃\n" +
          "┃ 🛡️ فهرست مدیران\n" +
          "┃ ─────────────────\n";

        admins.forEach((p, i) => {
          const id =
            p.id ||
            p.jid ||
            p.participant ||
            p.phoneNumber;

          out +=
            "┃ " +
            (i + 1) +
            "️⃣ @" +
            cleanJid(id) +
            "\n";
        });

        out +=
          "┃\n" +
          "╰━━〔 👻 " + BOT_NAME + " 〕━━╯";

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

        let out =
          "╭━━━〔 👻 تگ همه اعضا 〕━━━╮\n" +
          "┃\n" +
          "┃ 👥 اعضای گروه\n" +
          "┃ ─────────────────\n";

        members.forEach((p, i) => {
          const memberId =
            p.id ||
            p.jid ||
            p.participant ||
            p.phoneNumber;

          out +=
            "┃ " +
            (i + 1) +
            "️⃣ @" +
            cleanJid(memberId) +
            "\n";
        });

        out +=
          "┃\n" +
          "╰━━〔 👻 " + BOT_NAME + " 〕━━╯";

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
              p.admin === "superadmin" ||
              p.admin === "owner"
          ) || [];

        if (!admins.length) {
          await send(sock, jid, {
            text: "❌ هیچ مدیری در گروه پیدا نشد."
          });
          return;
        }

        const mentions = [];

        for (const p of admins) {
          const ids = [
            p.jid,
            p.phoneNumber,
            p.pn,
            p.participant,
            p.participantAlt,
            p.id,
            p.lid
          ].filter(Boolean);

          const phoneJid = ids
            .map(String)
            .find(id =>
              id.endsWith("@s.whatsapp.net")
            );

          mentions.push(
            phoneJid ||
            p.id ||
            p.lid ||
            ids[0]
          );
        }

        const lines = [
          "╭━━━〔 👑 تگ مدیران 〕━━━╮",
          "┃",
          "┃ 🛡️ مدیران گروه",
          "┃ ─────────────────"
        ];

        admins.forEach((p, i) => {
          const mention = mentions[i];
          const number =
            String(mention)
              .split("@")[0]
              .replace(/\D/g, "");

          lines.push(
            `┃ ${i + 1}️⃣ @${number}`
          );
        });

        lines.push(
          "┃",
          "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
        );

        await send(sock, jid, {
          text: lines.join("\n"),
          mentions
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

      console.log(
        JSON.stringify({
          text,
          lower,
          isGroup,
          senderIsAdmin,
          botIsAdmin
        })
      );

      const removeCommand =
        lower === ".remove" ||
        lower.startsWith(".remove ") ||
        lower === "/remove" ||
        lower.startsWith("/remove ") ||
        lower === "remove" ||
        lower.startsWith("remove ") ||
        lower === ".kick" ||
        lower.startsWith(".kick ") ||
        lower === "/kick" ||
        lower.startsWith("/kick ") ||
        lower === "kick" ||
        lower.startsWith("kick ");

      if (removeCommand) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin) {
          await send(sock, jid, {
            text: "فقط مدیر گروه می‌تواند این دستور را استفاده کند."
          });
          return;
        }

        if (!botIsAdmin) {
          await send(sock, jid, {
            text: "اح‍ـــمـــدبــݪاݪ باید مدیر گروه باشد."
          });
          return;
        }

        const context =
          msg.message?.extendedTextMessage?.contextInfo ||
          msg.message?.imageMessage?.contextInfo ||
          msg.message?.videoMessage?.contextInfo ||
          msg.message?.documentMessage?.contextInfo ||
          msg.message?.audioMessage?.contextInfo ||
          msg.message?.stickerMessage?.contextInfo ||
          {};

        console.log(
          "REMOVE MENTION DEBUG:",
          JSON.stringify({
            mentions: getMentions(msg),
            mentionedJid: msg.message?.extendedTextMessage?.contextInfo?.mentionedJid,
            context: msg.message?.extendedTextMessage?.contextInfo
          }, null, 2)
        );

        const rawTargets = [];

        for (const user of getMentions(msg)) {
          if (user && !rawTargets.includes(user)) {
            rawTargets.push(user);
          }
        }

        const quotedIds = [
          context.participant,
          context.participantAlt,
          context.participantPn,
          context.senderPn,
          context.senderLid
        ].filter(Boolean);

        for (const user of quotedIds) {
          if (user && !rawTargets.includes(user)) {
            rawTargets.push(user);
          }
        }

        if (!rawTargets.length) {
          await send(sock, jid, {
            text:
              "روی پیام عضو ریپلای کن و .remove بزن.\n\n" +
              "یا عضو را منشن کن و .remove بزن."
          });
          return;
        }

        let groupMetadata = metadata;

        try {
          groupMetadata =
            await sock.groupMetadata(jid);
        } catch (e) {
          console.log(
            "REMOVE METADATA ERROR:",
            e.message
          );
        }

        const participants =
          groupMetadata?.participants || [];

        for (const rawTarget of rawTargets) {

          console.log(
            "REMOVE RAW TARGET:",
            rawTarget
          );

          let target = rawTarget;

          const found =
            participants.find(p => {
              const ids = [
                p.id,
                p.jid,
                p.phoneNumber,
                p.participant,
                p.participantAlt,
                p.lid,
                p.pn
              ].filter(Boolean);

              return ids.some(id => sameUser(id, rawTarget));
            });

          if (found) {

            console.log(
              "REMOVE FOUND PARTICIPANT:",
              JSON.stringify(found, null, 2)
            );

            const phoneCandidates = [
              found.phoneNumber,
              found.participantAlt,
              found.pn,
              found.jid,
              found.id,
              found.participant,
              found.participantAlt
            ].filter(Boolean);

            const phoneJid =
              phoneCandidates.find(x => {
                const value = String(x);
                return (
                  value.includes("@s.whatsapp.net") &&
                  !value.includes("@lid")
                );
              });

            if (phoneJid) {
              target = phoneJid;
            } else {
              const numberCandidate =
                phoneCandidates.find(x => {
                  const value = String(x);
                  return (
                    !value.includes("@lid") &&
                    /^\+?\d{7,20}$/.test(
                      value.replace(/@.*$/, "")
                    )
                  );
                });

              if (numberCandidate) {
                target =
                  String(numberCandidate).replace(
                    /@.*$/,
                    ""
                  ) + "@s.whatsapp.net";
              }
            }

            console.log(
              "REMOVE RESOLVED TARGET:",
              target
            );
          }

          if (
            sameUser(target, botId) ||
            sameUser(target, sock.user?.id)
          ) {
            await send(sock, jid, {
              text: "اح‍ـــمـــدبــݪاݪ را نمی‌توان حذف کرد."
            });
            continue;
          }

          if (isAdmin(groupMetadata, target)) {
            await send(sock, jid, {
              text: "مدیر گروه را نمی‌توان حذف کرد."
            });
            continue;
          }

          try {
            console.log(
              "REMOVE TARGET:",
              target
            );

            await sock.groupParticipantsUpdate(
              jid,
              [target],
              "remove"
            );

            await send(sock, jid, {
              text: "عضو از گروه حذف شد."
            });

          } catch (e) {
            console.log(
              "REMOVE ERROR:",
              e
            );

            await send(sock, jid, {
              text:
                "حذف عضو انجام نشد.\n" +
                "جزئیات خطا در ترمینال نمایش داده شد."
            });
          }
        }

        return;
      }

      if (
        lower === ".promote" ||
        lower.startsWith(".promote ") ||
        lower === "/promote" ||
        lower.startsWith("/promote ") ||
        lower === "promote" ||
        lower.startsWith("promote ")
      ) {
        if (!isGroup) {
          await send(sock, jid, {
            text: "این دستور فقط در گروه کار می‌کند."
          });
          return;
        }

        if (!senderIsAdmin || !botIsAdmin) {
          await send(sock, jid, {
            text: "فرستنده و اح‍ـــمـــدبــݪاݪ باید مدیر گروه باشند."
          });
          return;
        }

        const ctx =
          msg.message?.extendedTextMessage?.contextInfo ||
          msg.message?.imageMessage?.contextInfo ||
          msg.message?.videoMessage?.contextInfo ||
          {};

        let targetRaw = null;

        // Reply
        if (ctx.participant) {
          targetRaw = ctx.participant;
        }

        // Mention / شماره‌ای که بعد از @ آمده
        if (!targetRaw) {
          const match = text.match(/@([0-9]+)/);

          if (match) {
            const requested = match[1];

            const participant =
              metadata?.participants?.find(p => {
                const ids = [
                  p.id,
                  p.jid,
                  p.lid,
                  p.phoneNumber,
                  p.pn,
                  p.participant,
                  p.participantAlt
                ].filter(Boolean);

                return ids.some(id => {
                  const value = String(id);

                  return (
                    value === requested ||
                    value.split("@")[0] === requested
                  );
                });
              });

            if (participant) {
              const phoneJid = [
                participant.jid,
                participant.phoneNumber,
                participant.pn,
                participant.participant,
                participant.participantAlt
              ]
                .filter(Boolean)
                .map(String)
                .find(id =>
                  id.endsWith("@s.whatsapp.net")
                );

              targetRaw =
                phoneJid ||
                participant.id ||
                participant.lid;
            }
          }
        }

        // Mention واقعی واتساپ، اگر موجود باشد
        if (!targetRaw) {
          const mentioned =
            ctx.mentionedJid ||
            ctx.mentionedJids ||
            [];

          if (
            Array.isArray(mentioned) &&
            mentioned.length
          ) {
            targetRaw = mentioned[0];

            const participant =
              metadata?.participants?.find(p => {
                const ids = [
                  p.id,
                  p.jid,
                  p.lid,
                  p.phoneNumber,
                  p.pn,
                  p.participant,
                  p.participantAlt
                ].filter(Boolean);

                return ids.some(id =>
                  sameUser(id, targetRaw)
                );
              });

            if (participant) {
              const phoneJid = [
                participant.jid,
                participant.phoneNumber,
                participant.pn,
                participant.participant,
                participant.participantAlt
              ]
                .filter(Boolean)
                .map(String)
                .find(id =>
                  id.endsWith("@s.whatsapp.net")
                );

              if (phoneJid) {
                targetRaw = phoneJid;
              }
            }
          }
        }

        if (!targetRaw) {
          await send(sock, jid, {
            text:
              "❌ عضو موردنظر پیدا نشد.\n\n" +
              "عضو را با @ تگ کن یا روی پیامش Reply بزن."
          });
          return;
        }

        console.log(
          "PROMOTE TARGET RAW:",
          targetRaw
        );

        try {
          const result =
            await sock.groupParticipantsUpdate(
              jid,
              [targetRaw],
              "promote"
            );

          console.log(
            "PROMOTE RESULT:",
            JSON.stringify(result)
          );

          

          const verify =
            await sock.groupMetadata(jid);

          const member =
            verify.participants?.find(p =>
              sameUser(
                p.id ||
                p.jid ||
                p.lid ||
                p.phoneNumber,
                targetRaw
              )
            );

          console.log(
            "PROMOTE VERIFY:",
            JSON.stringify(
              member
                ? {
                    id: member.id,
                    jid: member.jid,
                    lid: member.lid,
                    admin: member.admin
                  }
                : null
            )
          );

          const promoteSucceeded =
            Array.isArray(result) &&
            result.some(r =>
              String(r?.status) === "200" &&
              (
                r?.content?.attrs?.type === "admin" ||
                r?.content?.attrs?.type === "superadmin"
              )
            );

          if (
            promoteSucceeded ||
            (
              member &&
              (
                member.admin === "admin" ||
                member.admin === "superadmin" ||
                member.admin === "owner"
              )
            )
          ) {
            await send(sock, jid, {
              text:
                "╭━━━〔 👑 مدیر جدید 〕━━━╮\n" +
                "┃\n" +
                "┃ ✅ عضو با موفقیت مدیر شد.\n" +
                "┃\n" +
                "┃ 👻 اح‍ـــمـــدبــݪاݪ نۅࢪی\n" +
                "┃\n" +
                "╰━━━━━━━━━━━━━━━━━━╯"
            });
          } else {
            await send(sock, jid, {
              text:
                "❌ درخواست Promote موفقیت‌آمیز نبود."
            });
          }

        } catch (e) {
          console.log(
            "PROMOTE ERROR:",
            e?.message || e
          );

          await send(sock, jid, {
            text:
              "❌ مدیر کردن عضو انجام نشد."
          });
        }

        return;
      }

      if (
        lower === ".demote" ||
        lower === "/demote" ||
        lower === "demote" ||
        lower.startsWith(".demote ") ||
        lower.startsWith("/demote ") ||
        lower.startsWith("demote ")
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
              "فرستنده و اح‍ـــمـــدبــݪاݪ باید مدیر گروه باشند."
          });
          return;
        }

        const ctx =
          msg.message?.extendedTextMessage?.contextInfo ||
          msg.message?.imageMessage?.contextInfo ||
          msg.message?.videoMessage?.contextInfo ||
          {};

        let targets = getMentions(msg);

        // اگر Mention از متن/پیام به شکل LID آمد،
        // همان شناسه را از contextInfo هم بگیر
        if (!targets.length) {
          const mentioned =
            ctx.mentionedJid ||
            ctx.mentionedJids ||
            [];

          if (Array.isArray(mentioned)) {
            targets = mentioned;
          }
        }

        // Reply
        if (!targets.length && ctx.participant) {
          targets = [ctx.participant];
        }

        // Mention داخل متن، برای بعضی پیام‌های LID
        if (!targets.length) {
          const mentioned =
            lower.match(/@(\d+)/g) || [];

          if (mentioned.length && metadata?.participants) {
            for (const m of mentioned) {
              const number = m.replace("@", "");

              const found =
                metadata.participants.find(p => {
                  const ids = [
                    p.id,
                    p.jid,
                    p.phoneNumber,
                    p.participant,
                    p.participantAlt,
                    p.lid,
                    p.pn
                  ].filter(Boolean);

                  return ids.some(
                    id => cleanJid(id) === number
                  );
                });

              if (found) {
                targets.push(
                  found.id ||
                  found.jid ||
                  found.participant ||
                  found.phoneNumber ||
                  found.pn
                );
              }
            }
          }
        }

        if (!targets.length) {
          await send(sock, jid, {
            text:
              "╭━━━〔 👻 گرفتن مدیریت 〕━━━╮\n" +
              "┃\n" +
              "┃ 👤 عضو موردنظر را منشن کن\n" +
              "┃ یا روی پیامش Reply بزن.\n" +
              "┃\n" +
              "╰━━━━━━━━━━━━━━━━━━╯"
          });
          return;
        }

        for (const rawTarget of targets) {
          let target = String(rawTarget);

          const participant =
            metadata?.participants?.find(p => {
              const ids = [
                p.id,
                p.jid,
                p.phoneNumber,
                p.participant,
                p.participantAlt,
                p.lid,
                p.pn
              ].filter(Boolean);

              return ids.some(
                id => sameUser(id, rawTarget)
              );
            });

          if (participant) {
            const ids = [
              participant.jid,
              participant.id,
              participant.participant,
              participant.phoneNumber,
              participant.pn
            ].filter(Boolean);

            const normalJid = ids.find(
              id =>
                String(id).endsWith("@s.whatsapp.net")
            );

            target = String(
              normalJid ||
              ids[0] ||
              rawTarget
            );
          }

          console.log(
            "DEMOTE TARGET:",
            rawTarget,
            "=>",
            target
          );

          try {
            const result =
              await sock.groupParticipantsUpdate(
                jid,
                [target],
                "demote"
              );

            console.log(
              "DEMOTE RESULT:",
              JSON.stringify(result)
            );

            await new Promise(
              resolve => setTimeout(resolve, 1200)
            );

            const fresh =
              await sock.groupMetadata(jid);

            const updated =
              fresh.participants?.find(p => {
                const ids = [
                  p.id,
                  p.jid,
                  p.phoneNumber,
                  p.participant,
                  p.participantAlt,
                  p.lid,
                  p.pn
                ].filter(Boolean);

                return ids.some(
                  id => sameUser(id, target)
                );
              });

            const stillAdmin =
              updated &&
              (
                updated.admin === "admin" ||
                updated.admin === "superadmin" ||
                updated.admin === "owner"
              );

            console.log(
              "DEMOTE VERIFY:",
              JSON.stringify(updated)
            );

            if (stillAdmin) {
              await send(sock, jid, {
                text:
                  "❌ مدیریت عضو گرفته نشد.\n" +
                  "واتساپ عملیات را تأیید نکرد."
              });
              return;
            }

          } catch (e) {
            console.log("DEMOTE ERROR:", e);

            await send(sock, jid, {
              text:
                "╭━━━〔 ❌ خطا 〕━━━╮\n" +
                "┃\n" +
                "┃ گرفتن مدیریت انجام نشد.\n" +
                "┃ خطای دقیق در Termux ثبت شد.\n" +
                "┃\n" +
                "╰━━━━━━━━━━━━━━━━╯"
            });
            return;
          }
        }

        await send(sock, jid, {
          text:
            "╭━━━〔 👻 مدیریت گرفته شد 〕━━━╮\n" +
            "┃\n" +
            "┃ ✅ مدیریت عضو با موفقیت گرفته شد.\n" +
            "┃\n" +
            "┃ 👻 اح‍ـــمـــدبــݪاݪ نۅࢪی\n" +
            "┃\n" +
            "╰━━━━━━━━━━━━━━━━━━╯"
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
              "فرستنده و اح‍ـــمـــدبــݪاݪ باید مدیر گروه باشند."
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
              "فرستنده و اح‍ـــمـــدبــݪاݪ باید مدیر گروه باشند."
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
              "╭━━━〔 👑 مالک گروه 〕━━━╮\n" +
              "┃\n" +
              "┃ 🏆 مالک اصلی گروه\n" +
              "┃ ─────────────────\n" +
              "┃ 👤 @" +
              cleanJid(owner) +
              "\n" +
              "┃\n" +
              "┃ 🔐 مدیریت گروه\n" +
              "┃\n" +
              "╰━━〔 👻 " + BOT_NAME + " 〕━━╯",
            mentions: [owner]
          });
        } else {
          await send(sock, jid, {
            text:
              "╭━━━〔 👑 مالک گروه 〕━━━╮\n" +
              "┃\n" +
              "┃ ❌ معلومات مالک گروه\n" +
              "┃ از واتساپ دریافت نشد.\n" +
              "┃\n" +
              "╰━━〔 👻 " + BOT_NAME + " 〕━━╯"
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


// ===== TEST_MUTE_V2_SYSTEM_START =====
globalThis.__activeGroupCalls = globalThis.__activeGroupCalls || new Map();

async function sendTestMuteV2(sock, groupJid, muteState) {
  const call = globalThis.__activeGroupCalls.get(groupJid);

  if (!call) {
    await send(sock, groupJid, {
      text: "❌ هیچ تماس گروهی فعالی برای تست پیدا نشد."
    });
    return;
  }

  const peer =
    call.peer ||
    call.callCreator;

  const node = {
    tag: "call",
    attrs: {
      to: peer
    },
    content: [
      {
        tag: "mute_v2",
        attrs: {
          "call-id": call.callId,
          "call-creator": call.callCreator,
          "mute-state": String(muteState)
        }
      }
    ]
  };

  console.log("\n========== TEST MUTE_V2 SEND ==========");
  console.log(JSON.stringify(node, null, 2));
  console.log("=======================================\n");

  await sock.sendNode(node);

  await send(sock, groupJid, {
    text:
      "✅ تست mute_v2 ارسال شد.\n" +
      "حالت: " + String(muteState)
  });
}
// ===== TEST_MUTE_V2_SYSTEM_END =====


// ===== REAL_CALL_STATS_START =====
// ثبت مدت واقعی تماس‌های گروهی
globalThis.__callStats = globalThis.__callStats || {};
globalThis.__callActive = globalThis.__callActive || {};

function getCallStatsUser(jid) {
  const id = cleanJid(jid);
  if (!id) return null;

  if (!globalThis.__callStats[id]) {
    globalThis.__callStats[id] = {
      seconds: 0,
      calls: 0
    };
  }

  return globalThis.__callStats[id];
}

function getCallMinutes(jid) {
  const stats = getCallStatsUser(jid);
  if (!stats) return 0;
  return Math.floor(Number(stats.seconds || 0) / 60);
}

function formatCallDuration(jid) {
  const stats = getCallStatsUser(jid);
  const seconds = Math.max(0, Number(stats?.seconds || 0));

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;

  if (h > 0) return `${h}س ${m}د`;
  if (m > 0) return `${m}د ${sec}ث`;
  return `${sec}ث`;
}
// ===== REAL_CALL_STATS_END =====

// ===== CALL_DEBUG_LISTENER =====
sock.ev.on("call", calls => {
  try {
    for (const call of calls || []) {
      console.log("\n========== CALL DEBUG ==========");
      console.log("STATUS:", call.status);
      console.log("CALL ID:", call.id);
      console.log("FROM:", call.from);
      console.log("CHAT ID:", call.chatId);
      console.log("GROUP JID:", call.groupJid);
      console.log("IS GROUP:", call.isGroup);
      console.log("IS VIDEO:", call.isVideo);

      const groupJid =
        call.groupJid ||
        call.chatId ||
        "";

      const callId =
        call.id ||
        "";

      const participants =
        call.participants ||
        call.users ||
        [];

      const status =
        String(call.status || "").toLowerCase();

      // شروع تماس
      if (
        groupJid &&
        (
          status === "offer" ||
          status === "ringing" ||
          status === "accept" ||
          status === "active" ||
          status === "connected"
        )
      ) {
        globalThis.__callActive[
          groupJid + ":" + callId
        ] = {
          startedAt: Date.now(),
          users: participants.map(x =>
            typeof x === "string"
              ? x
              : x?.jid || x?.id || x?.participant
          ).filter(Boolean)
        };
      }

      // پایان تماس
      if (
        groupJid &&
        (
          status === "terminate" ||
          status === "ended" ||
          status === "reject" ||
          status === "timeout"
        )
      ) {
        const key =
          groupJid + ":" + callId;

        const active =
          globalThis.__callActive[key];

        if (active) {
          const seconds =
            Math.max(
              0,
              Math.floor(
                (Date.now() - active.startedAt) / 1000
              )
            );

          for (const user of active.users || []) {
            const stats =
              getCallStatsUser(user);

            if (!stats) continue;

            stats.seconds += seconds;
            stats.calls += 1;
          }

          delete globalThis.__callActive[key];

          console.log(
            "REAL CALL DURATION:",
            seconds,
            "seconds"
          );
        }
      }

      console.log("================================\n");
    }
  } catch (e) {
    console.log(
      "CALL DEBUG ERROR:",
      e.message
    );
  }
});
// ===== END CALL_DEBUG_LISTENER =====

});


// ===== NAME_PHONE_DISPLAY_FIX =====
function getRealMemberPhone(participant) {
  if (!participant) return "";

  const jidCandidates = [
    participant.jid,
    participant.phoneNumber,
    participant.pn,
    participant.participant,
    participant.participantAlt
  ].filter(Boolean);

  for (const value of jidCandidates) {
    const raw = String(value);
    if (raw.includes("@lid")) continue;

    const digits = raw
      .split(":")[0]
      .split("@")[0]
      .replace(/\D/g, "");

    if (digits.length >= 8 && digits.length <= 15) {
      return digits;
    }
  }

  return "";
}

function getNameOrRealPhone(participant, fallbackJid = "") {
  if (!participant) {
    const raw = String(fallbackJid || "");
    if (!raw.includes("@lid")) {
      const digits = raw
        .split(":")[0]
        .split("@")[0]
        .replace(/\D/g, "");

      if (digits.length >= 8 && digits.length <= 15) {
        return digits;
      }
    }
    return "";
  }

  const name = String(
    participant.notify ||
    participant.name ||
    participant.vname ||
    participant.verifiedName ||
    ""
  ).trim();

  if (name) return name;

  return getRealMemberPhone(participant);
}

function getDisplayMentionJid(participant, fallbackJid = "") {
  if (!participant) return fallbackJid || "";

  // برای تگ، JID واقعی را ترجیح بده؛ LID فقط شناسه داخلی است.
  const candidates = [
    participant.jid,
    participant.phoneNumber,
    participant.pn,
    participant.participant,
    participant.participantAlt
  ].filter(Boolean);

  for (const value of candidates) {
    const raw = String(value);
    if (raw.includes("@s.whatsapp.net")) return raw;
  }

  return fallbackJid || "";
}
// ===== NAME_PHONE_DISPLAY_FIX =====
