const fs = require("fs")

const startTime = Date.now()

function getUptime() {
  const total = Math.floor((Date.now() - startTime) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}j ${m}m ${s}d`
}

// ======================
// LOAD DATABASE
// ======================
let db
try {
  db = JSON.parse(fs.readFileSync("./database.json"))
} catch {
  db = {}
}

if (!db.owners)        db.owners        = []
if (!db.allowedUsers)  db.allowedUsers  = []
if (!db.linkPS)        db.linkPS        = ""
if (!db.promosi)       db.promosi       = ""
if (!db.groupSettings) db.groupSettings = {}

db.owners       = [...new Set(db.owners)]
db.allowedUsers = [...new Set(db.allowedUsers)]

const saveDB = () => {
  db.owners       = [...new Set(db.owners)]
  db.allowedUsers = [...new Set(db.allowedUsers)]
  fs.writeFileSync("./database.json", JSON.stringify(db, null, 2))
}

saveDB()

// ======================
// HELPER: ambil/init setting per grup
// ======================
function getGS(gid) {
  if (!db.groupSettings[gid]) {
    db.groupSettings[gid] = {
      antilink:     true,
      antiteruskan: true,
      welcome:      "",
      bye:          ""
    }
    saveDB()
  }
  return db.groupSettings[gid]
}

// ======================
// HELPER: cek pesan dari/terkait saluran
// ======================
function isChannelMessage(msg) {
  const m = msg.message

  const ctxInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo ||
    m?.audioMessage?.contextInfo ||
    m?.stickerMessage?.contextInfo ||
    m?.buttonsMessage?.contextInfo ||
    m?.listMessage?.contextInfo ||
    m?.templateMessage?.contextInfo

  if (ctxInfo?.forwardedNewsletterMessageInfo) return true
  if (ctxInfo?.forwardAttribution === "NEWSLETTER") return true
  if (m?.newsletterAdminInviteMessage) return true
  if (m?.scheduledCallCreationMessage) return true

  const textSources = [
    m?.conversation,
    m?.extendedTextMessage?.text,
    m?.imageMessage?.caption,
    m?.videoMessage?.caption,
    m?.documentMessage?.caption,
    m?.buttonsMessage?.contentText,
    m?.listMessage?.description,
    m?.templateMessage?.hydratedTemplate?.hydratedContentText,
  ]

  for (const t of textSources) {
    if (!t) continue
    const lower = t.toLowerCase()
    if (
      lower.includes("chat.whatsapp.com") ||
      lower.includes("whatsapp.com/channel") ||
      lower.includes("wa.me/channel") ||
      lower.includes("whatsapp.com/newsletter")
    ) return true
  }

  if (ctxInfo?.participant?.endsWith("@newsletter")) return true
  if (ctxInfo?.remoteJid?.endsWith("@newsletter")) return true

  return false
}

// ======================
// HANDLER
// ======================
module.exports = async (sock, msg) => {
  try {
    const from   = msg.key.remoteJid
    const sender = msg.key.participant || msg.key.remoteJid
    const senderNumber = sender.split("@")[0].split(":")[0]

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text

    const text    = body ? body.toLowerCase() : ""
    const isGroup = from.endsWith("@g.us")

    // ======================
    // GROUP DATA
    // ======================
    let groupMetadata = isGroup ? await sock.groupMetadata(from) : {}
    let participants  = isGroup ? groupMetadata.participants : []
    let groupAdmins   = isGroup
      ? participants.filter(v => v.admin !== null).map(v => v.id)
      : []

    const isAdmin   = groupAdmins.includes(sender)
    const isOwner   = db.owners.includes(senderNumber)
    const isAllowed = isAdmin || isOwner || db.allowedUsers.includes(senderNumber)

    // ======================
    // PROTEKSI GRUP (antilink & antiteruskan)
    // ======================
    if (isGroup && !isAllowed && !groupAdmins.includes(sender)) {
      const gs = getGS(from)

      if (gs.antiteruskan && isChannelMessage(msg)) {
        try {
          await sock.sendMessage(from, {
            delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: sender }
          })
        } catch (e) { console.log("Gagal hapus:", e.message) }

        try {
          await sock.groupParticipantsUpdate(from, [sender], "remove")
        } catch (e) { console.log("Gagal kick:", e.message) }

        sock.sendMessage(from, {
          text: `🚫 @${senderNumber} dikeluarkan karena meneruskan konten saluran!`,
          mentions: [sender]
        })
        return
      }

      if (gs.antilink) {
        const allText = [
          msg.message?.conversation,
          msg.message?.extendedTextMessage?.text,
          msg.message?.imageMessage?.caption,
          msg.message?.videoMessage?.caption,
        ].filter(Boolean).join(" ").toLowerCase()

        const hasLink = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com/i.test(allText)

        if (hasLink) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: sender }
            })
          } catch (e) { console.log("Gagal hapus:", e.message) }

          sock.sendMessage(from, {
            text: `⚠️ @${senderNumber} dilarang mengirim link di grup ini!`,
            mentions: [sender]
          })
          return
        }
      }
    }

    if (!text) return

    // ======================
    // MENU
    // ======================
    if (text === ".menu") {
      const uptime = getUptime()
      const linkps = db.linkPS || "Belum diset"
      let statusGrup = ""
      if (isGroup) {
        const gs = getGS(from)
        statusGrup = `│\n│ 🔗 Antilink: ${gs.antilink ? "✅ ON" : "❌ OFF"}\n│ 📢 Anti Teruskan: ${gs.antiteruskan ? "✅ ON" : "❌ OFF"}`
      }

      return sock.sendMessage(from, {
        text: `
╭─❖「 *MENU BOT* 」❖
│ ⏱️ Uptime: ${uptime}
│ 🔗 Link PS: ${linkps}${statusGrup}
│
│ 📢 .linkps
│
├─❖「 *ADMIN & OWNER* 」
│ ⚙️ .kick (reply/tag)
│ 🗑️ .del (reply)
│ 🔓 .open
│ 🔒 .close
│ 🔗 .setlinkps <link>
│ 📣 .promosi
│ 📣 .setpromosi <teks>
│
│ 👋 .setwelcome <teks>
│ 👋 .setbye <teks>
│ 🔗 .antilink on/off
│ 📢 .antiteruskan on/off
│
│ ⭐ .addakses (tag)
│ ❌ .delakses (tag)
│ 📋 .listakses
│
│ 👤 .addowner (tag)
│ ❌ .delowner (tag)
│ 📋 .listowner
╰───────────────
        `.trim()
      })
    }

    // ======================
    // LINK PS
    // ======================
    if (text === ".linkps") {
      if (!db.linkPS)
        return sock.sendMessage(from, { text: "📭 Link PS belum diset" })

      return sock.sendMessage(from, { text: `🔗 *Link PS:*\n${db.linkPS}` })
    }

    // ======================
    // SET LINK PS
    // ======================
    if (text.startsWith(".setlinkps")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const link = body.slice(10).trim()
      if (!link)
        return sock.sendMessage(from, { text: "❌ Tulis linknya\nContoh: .setlinkps https://wa.me/628xxx" })

      db.linkPS = link
      saveDB()
      return sock.sendMessage(from, { text: `✅ Link PS berhasil disimpan:\n${link}` })
    }

    // ======================
    // PROMOSI
    // ======================
    if (text === ".promosi") {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      if (!db.promosi)
        return sock.sendMessage(from, { text: "📭 Teks promosi belum diset" })

      return sock.sendMessage(from, { text: db.promosi })
    }

    // ======================
    // SET PROMOSI
    // ======================
    if (text.startsWith(".setpromosi")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const teks = body.slice(11).trim()
      if (!teks)
        return sock.sendMessage(from, { text: "❌ Tulis teks promosinya\nContoh: .setpromosi Halo! Kami buka order..." })

      db.promosi = teks
      saveDB()
      return sock.sendMessage(from, { text: "✅ Teks promosi berhasil disimpan" })
    }

    // ======================
    // SET WELCOME
    // ======================
    if (text.startsWith(".setwelcome")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const teks = body.slice(11).trim()
      if (!teks)
        return sock.sendMessage(from, {
          text: "❌ Tulis teks welcomenya\nVariabel tersedia:\n{user} = nama member\n{group} = nama grup\n{count} = jumlah member\n\nContoh:\n.setwelcome Halo @{user}! Selamat datang di {group} 🎉"
        })

      const gs = getGS(from)
      gs.welcome = teks
      saveDB()
      return sock.sendMessage(from, { text: `✅ Teks welcome disimpan:\n\n${teks}` })
    }

    // ======================
    // SET BYE
    // ======================
    if (text.startsWith(".setbye")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const teks = body.slice(7).trim()
      if (!teks)
        return sock.sendMessage(from, {
          text: "❌ Tulis teks byenya\nVariabel tersedia:\n{user} = nama member\n{group} = nama grup\n{count} = sisa member\n\nContoh:\n.setbye Sampai jumpa @{user} 👋"
        })

      const gs = getGS(from)
      gs.bye = teks
      saveDB()
      return sock.sendMessage(from, { text: `✅ Teks bye disimpan:\n\n${teks}` })
    }

    // ======================
    // ANTILINK ON/OFF
    // ======================
    if (text.startsWith(".antilink")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = text.split(" ")[1]
      if (arg !== "on" && arg !== "off")
        return sock.sendMessage(from, { text: "❌ Gunakan: .antilink on atau .antilink off" })

      const gs = getGS(from)
      gs.antilink = arg === "on"
      saveDB()
      return sock.sendMessage(from, {
        text: `🔗 Antilink *${arg.toUpperCase()}* di grup ini`
      })
    }

    // ======================
    // ANTITERUSKAN ON/OFF
    // ======================
    if (text.startsWith(".antiteruskan")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = text.split(" ")[1]
      if (arg !== "on" && arg !== "off")
        return sock.sendMessage(from, { text: "❌ Gunakan: .antiteruskan on atau .antiteruskan off" })

      const gs = getGS(from)
      gs.antiteruskan = arg === "on"
      saveDB()
      return sock.sendMessage(from, {
        text: `📢 Anti Teruskan Saluran *${arg.toUpperCase()}* di grup ini`
      })
    }

    // ======================
    // ADD AKSES
    // ======================
    if (text.startsWith(".addakses")) {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Hanya di grup" })
      if (!isOwner && !isAdmin) return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = target.split("@")[0].split(":")[0]
      if (db.allowedUsers.includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Sudah ada akses" })

      db.allowedUsers.push(targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `✅ Akses ditambahkan untuk @${targetNumber}`,
        mentions: [target]
      })
    }

    // ======================
    // DEL AKSES
    // ======================
    if (text.startsWith(".delakses")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = target.split("@")[0].split(":")[0]
      if (!db.allowedUsers.includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Nomor itu tidak ada di daftar akses" })

      db.allowedUsers = db.allowedUsers.filter(v => v !== targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `❌ Akses dihapus untuk @${targetNumber}`,
        mentions: [target]
      })
    }

    // ======================
    // LIST AKSES
    // ======================
    if (text === ".listakses") {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })
      if (db.allowedUsers.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada user yang punya akses" })

      let teks = "📋 *LIST AKSES:*\n\n"
      db.allowedUsers.forEach((u, i) => { teks += `${i + 1}. @${u}\n` })
      const mentions = db.allowedUsers.map(u => u + "@s.whatsapp.net")
      return sock.sendMessage(from, { text: teks, mentions })
    }

    // ======================
    // ADD OWNER
    // ======================
    if (text.startsWith(".addowner")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = target.split("@")[0].split(":")[0]
      if (db.owners.includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Sudah jadi owner" })

      db.owners.push(targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `✅ @${targetNumber} ditambahkan sebagai owner`,
        mentions: [target]
      })
    }

    // ======================
    // DEL OWNER
    // ======================
    if (text.startsWith(".delowner")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = target.split("@")[0].split(":")[0]
      if (!db.owners.includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Nomor itu bukan owner" })

      if (db.owners.length === 1 && db.owners[0] === senderNumber)
        return sock.sendMessage(from, { text: "⚠️ Tidak bisa hapus owner terakhir" })

      db.owners = db.owners.filter(v => v !== targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `❌ @${targetNumber} dihapus dari owner`,
        mentions: [target]
      })
    }

    // ======================
    // LIST OWNER
    // ======================
    if (text === ".listowner") {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })
      if (db.owners.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada owner terdaftar" })

      let teks = "👑 *LIST OWNER:*\n\n"
      db.owners.forEach((u, i) => { teks += `${i + 1}. @${u}\n` })
      const mentions = db.owners.map(u => u + "@s.whatsapp.net")
      return sock.sendMessage(from, { text: teks, mentions })
    }

    // ======================
    // KICK
    // ======================
    if (text.startsWith(".kick")) {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      if (!isGroup)   return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message?.extendedTextMessage?.contextInfo?.participant

      if (!target) return sock.sendMessage(from, { text: "❌ Reply/tag member" })
      if (groupAdmins.includes(target))
        return sock.sendMessage(from, { text: "❌ Tidak bisa kick admin" })

      await sock.groupParticipantsUpdate(from, [target], "remove")
      sock.sendMessage(from, {
        text: `✅ @${target.split("@")[0]} berhasil dikeluarkan`,
        mentions: [target]
      })
    }

    // ======================
    // DELETE PESAN
    // ======================
    if (text === ".del") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })

      const quoted = msg.message?.extendedTextMessage?.contextInfo
      if (!quoted) return sock.sendMessage(from, { text: "❌ Reply pesan" })

      await sock.sendMessage(from, {
        delete: {
          remoteJid: from, fromMe: false,
          id: quoted.stanzaId, participant: quoted.participant
        }
      })
    }

    // ======================
    // OPEN GROUP
    // ======================
    if (text === ".open") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      await sock.groupSettingUpdate(from, "not_announcement")
      sock.sendMessage(from, { text: "✅ Grup dibuka" })
    }

    // ======================
    // CLOSE GROUP
    // ======================
    if (text === ".close") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      await sock.groupSettingUpdate(from, "announcement")
      sock.sendMessage(from, { text: "🔒 Grup ditutup" })
    }

  } catch (err) {
    console.log("Error handler:", err)
  }
}
