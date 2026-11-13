const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

// WEBHOOK DISCORD E DOMÍNIO OFICIAL DO RENDER
const WEBHOOK_URL = "https://discord.com/api/webhooks/1570787328627187845/Zc0rMg7oNb7RMjqjsa8eoDnvg4loKjfluJmoTVW2qdKGmMwkRpRIN2acAKMot3ql9uAZ";
const BASE_URL = "https://srt-custom.onrender.com";

app.use(express.static(path.join(__dirname, 'public')));

// 1. PÁGINA PRINCIPAL (MENU / LANDING PAGE)
app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. PÁGINA DE CRIAR TRANSMISSÃO (PAINEL DO MECÂNICO)
app.get(['/criar', '/painel', '/painel.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'painel.html'));
});

// 3. PÁGINA DE VISUALIZAÇÃO EM TELA INTEIRA (CLIENTE / TELÃO)
app.get(['/transmissao1', '/transmissao2', '/transmissao3', '/assistir.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'assistir.html'));
});

function formatRoomName(room) {
    const num = room.replace('transmissao', '');
    return `TRANSMISSÃO ${num}`;
}

io.on('connection', (socket) => {
    socket.on('join-room', (room) => {
        socket.join(room);
    });

    // Avisa no Discord quando inicia a transmissão
    socket.on('stream-started', async (info) => {
        const room = info.room || 'transmissao1';
        const roomLabel = formatRoomName(room);
        const viewUrl = `${BASE_URL}/${room}`;

        try {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: "SRT Motors Custom",
                    embeds: [{
                        title: `🔴 ${roomLabel} INICIADA!`,
                        color: 15073280,
                        description: `**Mecânico / ID:** ${info.usuario || 'Equipe SRT'}\n**Atividade:** ${info.nota || 'Acompanhamento de Oficina'}\n**Canal:** ${roomLabel}\n\n👉 **[CLIQUE AQUI PARA ASSISTIR EM TELA CHEIA](${viewUrl})**`,
                        footer: { text: "Cidade Nobre • SRT Motors Custom" },
                        timestamp: new Date().toISOString()
                    }]
                })
            });
        } catch (err) {
            console.error("Erro ao avisar início:", err);
        }
    });

    // Avisa no Discord quando encerra a transmissão
    socket.on('stream-stopped', async (info) => {
        const room = info.room || 'transmissao1';
        const roomLabel = formatRoomName(room);

        try {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: "SRT Motors Custom",
                    embeds: [{
                        title: `⚫ ${roomLabel} ENCERRADA`,
                        color: 2303786,
                        description: `**Mecânico / ID:** ${info.usuario || 'Equipe SRT'} encerrou a **${roomLabel}**.`,
                        footer: { text: "Cidade Nobre • SRT Motors Custom" },
                        timestamp: new Date().toISOString()
                    }]
                })
            });
        } catch (err) {
            console.error("Erro ao avisar fim:", err);
        }
    });

    // Repassa os frames ao vivo apenas para a sala escolhida
    socket.on('stream-frame', (payload) => {
        const room = payload.room || 'transmissao1';
        socket.to(room).emit('view-frame', payload.frame);
    });

    // Envia captura (print) para o Discord
    socket.on('sync-webhook', async (payload) => {
        const room = payload.room || 'transmissao1';
        const roomLabel = formatRoomName(room);
        const viewUrl = `${BASE_URL}/${room}`;

        try {
            const base64Data = payload.image.replace(/^data:image\/png;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');

            const formData = new FormData();
            const blob = new Blob([buffer], { type: 'image/png' });
            formData.append('file', blob, `srt-${room}.png`);

            const embedPayload = {
                username: "SRT Motors Custom",
                embeds: [{
                    title: `🖥️ SRT MOTORS CUSTOM | CAPTURA (${roomLabel})`,
                    color: 15073280,
                    description: `**Mecânico / ID:** ${payload.usuario || 'Equipe SRT'}\n**Serviço / Nota:** ${payload.nota || 'Registro de Oficina'}\n**Link ao vivo:** [Assistir ${roomLabel}](${viewUrl})`,
                    image: { url: `attachment://srt-${room}.png` },
                    footer: { text: "Cidade Nobre • SRT Motors Custom" },
                    timestamp: new Date().toISOString()
                }]
            };

            formData.append('payload_json', JSON.stringify(embedPayload));

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                socket.emit('sync-status', { ok: true, msg: `Captura da ${roomLabel} enviada para o Discord!` });
            } else {
                socket.emit('sync-status', { ok: false, fallback: true, msg: 'Erro no Discord. Imagem copiada para colar (Ctrl+V)!' });
            }
        } catch (err) {
            socket.emit('sync-status', { ok: false, fallback: true, msg: 'Falha na conexão. Imagem copiada para colar (Ctrl+V)!' });
        }
    });
});

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
    console.log(`SRT Motors Custom rodando na porta ${PORT}`);
});