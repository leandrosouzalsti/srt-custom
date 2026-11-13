const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

// SEU WEBHOOK CONFIGURADO
const WEBHOOK_URL = "https://discord.com/api/webhooks/1570787328627187845/Zc0rMg7oNb7RMjqjsa8eoDnvg4loKjfluJmoTVW2qdKGmMwkRpRIN2acAKMot3ql9uAZ";
const BASE_URL = "https://srt-motors-share.onrender.com";
app.use(express.static(path.join(__dirname, 'public')));

// Redireciona a raiz para o Box 1 e entrega a mesma interface para /box1, /box2 e /box3
app.get('/', (req, res) => {
    res.redirect('/box1');
});

app.get(['/box1', '/box2', '/box3'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    // Entra na sala específica (box1, box2 ou box3)
    socket.on('join-room', (room) => {
        socket.join(room);
        socket.currentRoom = room;
    });

    // 1. Avisa no Discord quando alguém inicia o compartilhamento em um dos Boxes
    socket.on('stream-started', async (info) => {
        const room = info.room || 'box1';
        const roomLabel = room.toUpperCase().replace('BOX', 'BOX ');
        const roomUrl = `${BASE_URL}/${room}`;

        try {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: "SRT Motors Custom",
                    embeds: [{
                        title: `🔴 TRANSMISSÃO INICIADA • ${roomLabel}`,
                        color: 15073280, // Vermelho SRT (#E60000)
                        description: `**Mecânico / ID:** ${info.usuario || 'Equipe SRT'}\n**Atividade:** ${info.nota || 'Acompanhamento de Oficina'}\n**Sala:** ${roomLabel}\n\n👉 **[CLIQUE AQUI PARA ASSISTIR AO VIVO (${roomLabel})](${roomUrl})**`,
                        footer: { text: "Cidade Nobre • SRT Share Multi-Box" },
                        timestamp: new Date().toISOString()
                    }]
                })
            });
        } catch (err) {
            console.error("Erro ao avisar início da transmissão:", err);
        }
    });

    // 2. Avisa no Discord quando a transmissão do Box é encerrada
    socket.on('stream-stopped', async (info) => {
        const room = info.room || 'box1';
        const roomLabel = room.toUpperCase().replace('BOX', 'BOX ');

        try {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: "SRT Motors Custom",
                    embeds: [{
                        title: `⚫ TRANSMISSÃO ENCERRADA • ${roomLabel}`,
                        color: 2303786,
                        description: `**Mecânico / ID:** ${info.usuario || 'Equipe SRT'} encerrou a tela no **${roomLabel}**.`,
                        footer: { text: "Cidade Nobre • SRT Share Multi-Box" },
                        timestamp: new Date().toISOString()
                    }]
                })
            });
        } catch (err) {
            console.error("Erro ao avisar fim da transmissão:", err);
        }
    });

    // 3. Repassa os frames apenas para quem está assistindo o mesmo Box
    socket.on('stream-frame', (payload) => {
        const room = payload.room || 'box1';
        socket.to(room).emit('view-frame', payload.frame);
    });

    // 4. Envia captura (print) da tela direto para o canal do Discord identificando o Box
    socket.on('sync-webhook', async (payload) => {
        const room = payload.room || 'box1';
        const roomLabel = room.toUpperCase().replace('BOX', 'BOX ');
        const roomUrl = `${BASE_URL}/${room}`;

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
                    description: `**Mecânico / ID:** ${payload.usuario || 'Equipe SRT'}\n**Serviço / Nota:** ${payload.nota || 'Registro de Oficina'}\n**Link desta tela:** [Assistir ${roomLabel}](${roomUrl})`,
                    image: { url: `attachment://srt-${room}.png` },
                    footer: { text: "Cidade Nobre • SRT Share Multi-Box" },
                    timestamp: new Date().toISOString()
                }]
            };

            formData.append('payload_json', JSON.stringify(embedPayload));

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                socket.emit('sync-status', { ok: true, msg: `Captura do ${roomLabel} enviada para o Discord!` });
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
    console.log(`SRT Motors Share Multi-Box rodando na porta ${PORT}`);
});