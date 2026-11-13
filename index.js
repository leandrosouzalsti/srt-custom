const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

// ================= CONFIGURAÇÃO DOS WEBHOOKS DISCORD =================
// 1. Webhook Geral (Transmissões e Cursos)
const WEBHOOK_URL = "https://discord.com/api/webhooks/1570787328627187845/Zc0rMg7oNb7RMjqjsa8eoDnvg4loKjfluJmoTVW2qdKGmMwkRpRIN2acAKMot3ql9uAZ";

// 2. Canal que recebe SOMENTE os recrutados INICIANTES
const WEBHOOK_INICIANTES = "COLE_AQUI_O_WEBHOOK_DO_CANAL_SOMENTE_INICIANTES";

// 3. Canal que recebe TODOS os recrutados (Iniciantes + Não Iniciantes)
const WEBHOOK_TODOS_RECRUTADOS = "COLE_AQUI_O_WEBHOOK_DO_CANAL_TODOS_RECRUTADOS";

// 4. Canal no OUTRO SERVIDOR (Recebe todos os recrutados + dados dos recrutadores)
const WEBHOOK_OUTRO_SERVIDOR = "COLE_AQUI_O_WEBHOOK_DO_CANAL_OUTRO_SERVIDOR";

// 5. Canal do RANKING (Recebe o rank atualizado e o @everyone de Recrutador da Semana)
const WEBHOOK_RANKING = "COLE_AQUI_O_WEBHOOK_DO_CANAL_RANKING";

// 6. Canal da PLANILHA DE PAGAMENTOS SEMANAIS (Recebe ID do Jogo + ID do Discord de cada recrutador + arquivo CSV)
const WEBHOOK_PAGAMENTOS_SEMANA = "COLE_AQUI_O_WEBHOOK_DO_CANAL_PLANILHA_PAGAMENTOS";

const BASE_URL = "https://srt-custom.onrender.com";

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Controle em memória das transmissões ativas
const activeStreams = {
    transmissao1: null,
    transmissao2: null,
    transmissao3: null
};

// ================= BANCO DE DADOS EM JSON =================
const DB_RECRUTADOS = path.join(__dirname, 'recrutados.json');
const DB_RANKING = path.join(__dirname, 'ranking.json');

function lerJSON(arquivo, padrao) {
    try {
        if (!fs.existsSync(arquivo)) return padrao;
        return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    } catch (e) {
        return padrao;
    }
}

function salvarJSON(arquivo, dados) {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
}

function limparIdDiscord(valor) {
    return String(valor || '').replace(/\D/g, '');
}

async function enviarWebhookSeguro(url, payload) {
    if (!url || !url.startsWith('http')) return;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Erro ao disparar webhook:", err);
    }
}

// Ordena o ranking semanal do maior para o menor
function obterRankingOrdenado() {
    const rankObj = lerJSON(DB_RANKING, {});
    return Object.values(rankObj).sort((a, b) => b.total - a.total);
}

// Atualiza o ranking ao vivo no canal de Ranking
async function publicarRankingAtualizado() {
    const lista = obterRankingOrdenado();
    if (lista.length === 0) return;

    const medalhas = ['🥇', '🥈', '🥉'];
    const linhas = lista.map((rec, index) => {
        const pos = medalhas[index] || `**${index + 1}º**`;
        return `${pos} <@${rec.discordId}> (${rec.nome} • ID Jogo: \`${rec.idJogo}\`) — **${rec.total}** rec. *(Ini: ${rec.iniciantes} | Exp: ${rec.experientes})*`;
    }).join('\n');

    await enviarWebhookSeguro(WEBHOOK_RANKING, {
        username: "SRT Motors Custom • Ranking RH",
        embeds: [{
            title: "🏆 RANKING SEMANAL DE RECRUTADORES (AO VIVO)",
            color: 15073280,
            description: `${linhas}\n\n⏳ *O fechamento oficial com @everyone e geração da planilha de pagamentos acontece todo Domingo às 00:00!*`,
            footer: { text: "Cidade Nobre • SRT Motors Custom" },
            timestamp: new Date().toISOString()
        }]
    });
}

// Gera e envia a planilha de pagamentos (Embed + Arquivo CSV) para o canal financeiro
async function enviarPlanilhaPagamentosSemana(listaRanking, dataFechamento) {
    if (!WEBHOOK_PAGAMENTOS_SEMANA || !WEBHOOK_PAGAMENTOS_SEMANA.startsWith('http')) return;

    const linhasTabela = listaRanking.map((rec, idx) => {
        return `**#${idx + 1}** | **${rec.nome}**\n🎮 ID Jogo: \`${rec.idJogo}\` • 💬 Discord: <@${rec.discordId}> (\`${rec.discordId}\`)\n📊 Total: **${rec.total}** recrutamento(s) *(Iniciantes: ${rec.iniciantes} | Não Iniciantes: ${rec.experientes})*`;
    }).join('\n────────────────────\n');

    const cabecalhoCSV = "Posicao;Nome_Recrutador;ID_Jogo;ID_Discord;Total_Recrutamentos;Iniciantes;Nao_Iniciantes\n";
    const corpoCSV = listaRanking.map((rec, idx) => {
        return `${idx + 1};"${rec.nome}";"${rec.idJogo}";"${rec.discordId}";${rec.total};${rec.iniciantes};${rec.experientes}`;
    }).join('\n');
    const csvBuffer = Buffer.from("\uFEFF" + cabecalhoCSV + corpoCSV, 'utf8');

    try {
        const formData = new FormData();
        formData.append('file', new Blob([csvBuffer], { type: 'text/csv' }), `pagamentos-recrutamento-${dataFechamento}.csv`);

        const payload = {
            username: "SRT Motors Custom • Financeiro RH",
            content: `💰 **PLANILHA SEMANAL DE PAGAMENTO • RECRUTAMENTO (${dataFechamento})**`,
            embeds: [{
                title: "📑 FECHAMENTO FINANCEIRO • RECRUTADORES DA SEMANA",
                color: 65398,
                description: `Relação oficial com **ID do Jogo** e **ID do Discord** para realização dos pagamentos referentes aos recrutamentos da semana:\n\n${linhasTabela}`,
                footer: { text: "Arquivo .CSV anexado acima • SRT Motors Custom" },
                timestamp: new Date().toISOString()
            }]
        };

        formData.append('payload_json', JSON.stringify(payload));

        await fetch(WEBHOOK_PAGAMENTOS_SEMANA, {
            method: 'POST',
            body: formData
        });
    } catch (err) {
        console.error("Erro ao enviar planilha de pagamentos:", err);
    }
}

// ================= FECHAMENTO SEMANAL AUTOMÁTICO (DOMINGO 00:00 BRASÍLIA) =================
let ultimaSemanaFechada = "";

async function executarFechamentoSemanal() {
    const lista = obterRankingOrdenado();
    if (lista.length === 0) return false;

    const agoraBrasil = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const dataFechamento = agoraBrasil.toISOString().slice(0, 10);
    const campeao = lista[0];

    const medalhas = ['🥇', '🥈', '🥉'];
    const topGeral = lista.map((rec, idx) => {
        const icone = medalhas[idx] || `#${idx + 1}`;
        return `${icone} <@${rec.discordId}> (${rec.nome} • ID Jogo: \`${rec.idJogo}\`) — **${rec.total}** recrutado(s)`;
    }).join('\n');

    await enviarWebhookSeguro(WEBHOOK_RANKING, {
        username: "SRT Motors Custom • Premiação Semanal",
        content: `@everyone 🏆 **ENCERRAMENTO DO RANKING SEMANAL!** Parabéns ao nosso grande **RECRUTADOR DA SEMANA**: <@${campeao.discordId}>! 🎉👏`,
        embeds: [{
            title: "👑 RECRUTADOR DA SEMANA • SRT MOTORS CUSTOM",
            color: 16766720,
            description: `Parabéns <@${campeao.discordId}> (**${campeao.nome}** • ID Jogo: \`${campeao.idJogo}\`) pelo excelente trabalho e dedicação na expansão da nossa equipe!\n\n🔥 **Total na semana:** **${campeao.total} recrutamento(s)** *(Iniciantes: ${campeao.iniciantes} | Não Iniciantes: ${campeao.experientes})*\n\n📊 **Classificação Final da Semana:**\n${topGeral}\n\n🔄 *A contagem foi zerada para a nova semana. Boa sorte a todos!*`,
            footer: { text: "Cidade Nobre • SRT Motors Custom" },
            timestamp: new Date().toISOString()
        }]
    });

    await enviarPlanilhaPagamentosSemana(lista, dataFechamento);
    salvarJSON(DB_RANKING, {});
    return true;
}

setInterval(async () => {
    const agoraBrasil = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaSemana = agoraBrasil.getDay();
    const hora = agoraBrasil.getHours();
    const minuto = agoraBrasil.getMinutes();
    const chaveHoje = agoraBrasil.toISOString().slice(0, 10);

    if (diaSemana === 0 && hora === 0 && minuto === 0 && ultimaSemanaFechada !== chaveHoje) {
        ultimaSemanaFechada = chaveHoje;
        await executarFechamentoSemanal();
    }
}, 30000);

// ================= ROTAS DAS PÁGINAS =================
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(['/criar', '/painel', '/painel.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get(['/cursos', '/cursos.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'cursos.html')));
app.get(['/recrutamento', '/recrutamento.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'recrutamento.html')));
app.get(['/guia', '/guia.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'guia.html')));
app.get(['/discord', '/discord.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'discord.html')));
app.get(['/transmissao1', '/transmissao2', '/transmissao3', '/assistir.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'assistir.html'));
});

// ================= API: CURSOS =================
app.post('/api/cursos', async (req, res) => {
    const { instrutor, aluno, idAluno, curso, resultado, observacao } = req.body;
    const aprovado = resultado === 'APROVADO';

    await enviarWebhookSeguro(WEBHOOK_URL, {
        username: "SRT Motors Custom • Academia",
        embeds: [{
            title: aprovado ? `🎓 CURSO APROVADO: ${curso.toUpperCase()}` : `❌ CURSO REPROVADO: ${curso.toUpperCase()}`,
            color: aprovado ? 15073280 : 3355443,
            fields: [
                { name: "Aluno / Mecânico", value: `${aluno} (ID: ${idAluno})`, inline: true },
                { name: "Instrutor", value: instrutor || "Equipe SRT", inline: true },
                { name: "Status", value: resultado, inline: true },
                { name: "Observações", value: observacao || "Sem observações.", inline: false }
            ],
            footer: { text: "Cidade Nobre • SRT Motors Custom" },
            timestamp: new Date().toISOString()
        }]
    });

    res.json({ ok: true });
});

// ================= API: RECRUTAMENTO & RANKING =================
app.get('/api/recrutamento', (req, res) => {
    res.json({
        lista: lerJSON(DB_RECRUTADOS, []),
        ranking: obterRankingOrdenado()
    });
});

app.post('/api/recrutamento', async (req, res) => {
    const {
        candidato,
        idCidadeCandidato,
        discordIdCandidato,
        tipoCandidato,
        telefone,
        valorTaxa,
        recrutador,
        idCidadeRecrutador,
        discordIdRecrutador,
        observacao
    } = req.body;

    const idDiscCand = limparIdDiscord(discordIdCandidato);
    const idDiscRec = limparIdDiscord(discordIdRecrutador);

    if (!idDiscCand || !idDiscRec || !idCidadeRecrutador) {
        return res.status(400).json({ ok: false, msg: "ID do Discord e ID do Jogo são obrigatórios." });
    }

    const perfil = tipoCandidato || "Iniciante";
    const isIniciante = perfil === "Iniciante";

    const novoRegistro = {
        id: Date.now().toString(),
        candidato,
        idCidadeCandidato: idCidadeCandidato || "N/A",
        discordIdCandidato: idDiscCand,
        tipoCandidato: perfil,
        telefone: telefone || "Não informado",
        recrutador,
        idCidadeRecrutador: String(idCidadeRecrutador).trim(),
        discordIdRecrutador: idDiscRec,
        valorTaxa: valorTaxa || "Taxa Padrão",
        observacao: observacao || "",
        status: "AGUARDANDO PAGAMENTO",
        data: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    };

    const lista = lerJSON(DB_RECRUTADOS, []);
    lista.unshift(novoRegistro);
    salvarJSON(DB_RECRUTADOS, lista);

    const rankObj = lerJSON(DB_RANKING, {});
    if (!rankObj[idDiscRec]) {
        rankObj[idDiscRec] = {
            discordId: idDiscRec,
            idJogo: novoRegistro.idCidadeRecrutador,
            nome: recrutador,
            total: 0,
            iniciantes: 0,
            experientes: 0
        };
    }
    rankObj[idDiscRec].nome = recrutador;
    rankObj[idDiscRec].idJogo = novoRegistro.idCidadeRecrutador;
    rankObj[idDiscRec].total += 1;
    if (isIniciante) {
        rankObj[idDiscRec].iniciantes += 1;
    } else {
        rankObj[idDiscRec].experientes += 1;
    }
    salvarJSON(DB_RANKING, rankObj);

    const embedBase = {
        title: `📋 NOVO RECRUTAMENTO • ${perfil.toUpperCase()}`,
        color: isIniciante ? 65398 : 15073280,
        fields: [
            { name: "Recrutado (Discord)", value: `<@${idDiscCand}>\n\`${idDiscCand}\``, inline: true },
            { name: "Nome / ID Jogo", value: `${candidato} (ID: ${novoRegistro.idCidadeCandidato})`, inline: true },
            { name: "Perfil", value: `**${perfil}**`, inline: true },
            { name: "Recrutador (Discord)", value: `<@${idDiscRec}>\n\`${idDiscRec}\``, inline: true },
            { name: "Recrutador (ID Jogo)", value: `${recrutador} (ID: \`${novoRegistro.idCidadeRecrutador}\`)`, inline: true },
            { name: "Taxa / Status", value: `${novoRegistro.valorTaxa} • ⏳ **AGUARDANDO PAGAMENTO**`, inline: true },
            { name: "Telefone / Obs", value: `📞 ${novoRegistro.telefone}${observacao ? ` • 📝 ${observacao}` : ''}`, inline: false }
        ],
        footer: { text: "Cidade Nobre • SRT Motors Custom" },
        timestamp: new Date().toISOString()
    };

    if (isIniciante) {
        await enviarWebhookSeguro(WEBHOOK_INICIANTES, {
            username: "SRT Motors Custom • Iniciantes",
            content: `🟢 Novo **Iniciante** recrutado: <@${idDiscCand}> (por <@${idDiscRec}>)`,
            embeds: [embedBase]
        });
    }

    await enviarWebhookSeguro(WEBHOOK_TODOS_RECRUTADOS, {
        username: "SRT Motors Custom • Recrutamentos",
        content: `📌 Novo registro (${perfil}): <@${idDiscCand}>`,
        embeds: [embedBase]
    });

    await enviarWebhookSeguro(WEBHOOK_OUTRO_SERVIDOR, {
        username: "SRT Motors Custom • Integração Externa",
        content: `🔁 **Sincronização de Recrutamento:** Recrutado <@${idDiscCand}> | Recrutador <@${idDiscRec}>`,
        embeds: [{
            title: "🤝 REGISTRO EXTERNO • RECRUTADO & RECRUTADOR",
            color: 5793266,
            fields: [
                { name: "👤 Recrutado", value: `Nome: **${candidato}**\nID Jogo: \`${novoRegistro.idCidadeCandidato}\`\nDiscord: <@${idDiscCand}> (\`${idDiscCand}\`)\nPerfil: **${perfil}**`, inline: true },
                { name: "🛡️ Recrutador", value: `Nome: **${recrutador}**\nID Jogo: \`${novoRegistro.idCidadeRecrutador}\`\nDiscord: <@${idDiscRec}> (\`${idDiscRec}\`)\nTotal na Semana: **${rankObj[idDiscRec].total}**`, inline: true }
            ],
            footer: { text: "SRT Motors Custom • Sincronização Entre Servidores" },
            timestamp: new Date().toISOString()
        }]
    });

    await publicarRankingAtualizado();

    res.json({ ok: true });
});

app.post('/api/recrutamento/:id/pagar', async (req, res) => {
    const lista = lerJSON(DB_RECRUTADOS, []);
    const item = lista.find(r => r.id === req.params.id);
    if (!item) return res.status(404).json({ ok: false });

    item.status = "PAGO / EFETIVADO";
    salvarJSON(DB_RECRUTADOS, lista);

    const payloadPago = {
        username: "SRT Motors Custom • RH",
        content: `✅ Pagamento confirmado para <@${item.discordIdCandidato}>!`,
        embeds: [{
            title: "✅ PAGAMENTO CONFIRMADO • CANDIDATO EFETIVADO",
            color: 15073280,
            description: `**Recrutado:** <@${item.discordIdCandidato}> (${item.candidato} • ID Jogo: ${item.idCidadeCandidato})\n**Perfil:** ${item.tipoCandidato}\n**Recrutador:** <@${item.discordIdRecrutador}> (ID Jogo: ${item.idCidadeRecrutador || 'N/A'})\n\nPagamento confirmado e efetivado na **SRT Motors Custom**!`,
            footer: { text: "Cidade Nobre • SRT Motors Custom" },
            timestamp: new Date().toISOString()
        }]
    };

    if (item.tipoCandidato === "Iniciante") {
        await enviarWebhookSeguro(WEBHOOK_INICIANTES, payloadPago);
    }
    await enviarWebhookSeguro(WEBHOOK_TODOS_RECRUTADOS, payloadPago);

    res.json({ ok: true });
});

app.post('/api/recrutamento/fechar-semana', async (req, res) => {
    const ok = await executarFechamentoSemanal();
    res.json({ ok });
});

app.delete('/api/recrutamento/:id', (req, res) => {
    const lista = lerJSON(DB_RECRUTADOS, []).filter(r => r.id !== req.params.id);
    salvarJSON(DB_RECRUTADOS, lista);
    res.json({ ok: true });
});

// ================= SOCKET.IO & WEBRTC: TRANSMISSÕES HD =================
function formatRoomName(room) {
    return `TRANSMISSÃO ${room.replace('transmissao', '')}`;
}

function broadcastRoomsStatus() {
    io.emit('rooms-status', activeStreams);
}

io.on('connection', (socket) => {
    socket.emit('rooms-status', activeStreams);

    socket.on('join-room', (room) => {
        socket.join(room);
        if (activeStreams[room]) {
            io.to(activeStreams[room].socketId).emit('viewer-joined', socket.id);
        }
    });

    // Sinalização WebRTC (Vídeo direto P2P em 1080p / 30fps)
    socket.on('webrtc-offer', (data) => {
        io.to(data.to).emit('webrtc-offer', { from: socket.id, offer: data.offer });
    });

    socket.on('webrtc-answer', (data) => {
        io.to(data.to).emit('webrtc-answer', { from: socket.id, answer: data.answer });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        io.to(data.to).emit('webrtc-ice-candidate', { from: socket.id, candidate: data.candidate });
    });

    socket.on('request-start-stream', async (info, callback) => {
        const room = info.room || 'transmissao1';
        const roomLabel = formatRoomName(room);

        if (activeStreams[room] && activeStreams[room].socketId !== socket.id) {
            if (callback) {
                callback({
                    ok: false,
                    msg: `⛔ CANAL OCUPADO! A ${roomLabel} já está em uso por: ${activeStreams[room].usuario}.`
                });
            }
            return;
        }

        const nomeUsuario = (info.usuario && info.usuario.trim()) ? info.usuario.trim() : 'Equipe SRT';
        activeStreams[room] = {
            socketId: socket.id,
            usuario: nomeUsuario,
            nota: info.nota || 'Acompanhamento de Oficina'
        };

        broadcastRoomsStatus();
        if (callback) callback({ ok: true });

        const viewUrl = `${BASE_URL}/${room}`;
        await enviarWebhookSeguro(WEBHOOK_URL, {
            username: "SRT Motors Custom",
            embeds: [{
                title: `🔴 ${roomLabel} INICIADA!`,
                color: 15073280,
                description: `**Mecânico / ID:** ${nomeUsuario}\n**Atividade:** ${info.nota || 'Acompanhamento de Oficina'}\n**Canal:** ${roomLabel}\n\n👉 **[CLIQUE AQUI PARA ASSISTIR EM TELA CHEIA](${viewUrl})**`,
                footer: { text: "Cidade Nobre • SRT Motors Custom" },
                timestamp: new Date().toISOString()
            }]
        });
    });

    socket.on('stream-stopped', async (info) => {
        const room = info.room || 'transmissao1';
        const roomLabel = formatRoomName(room);

        if (activeStreams[room] && activeStreams[room].socketId === socket.id) {
            const usuarioAnterior = activeStreams[room].usuario;
            activeStreams[room] = null;
            broadcastRoomsStatus();

            await enviarWebhookSeguro(WEBHOOK_URL, {
                username: "SRT Motors Custom",
                embeds: [{
                    title: `⚫ ${roomLabel} ENCERRADA`,
                    color: 2303786,
                    description: `**Mecânico / ID:** ${usuarioAnterior} encerrou a **${roomLabel}**. Canal liberado!`,
                    footer: { text: "Cidade Nobre • SRT Motors Custom" },
                    timestamp: new Date().toISOString()
                }]
            });
        }
    });

    socket.on('disconnect', () => {
        let changed = false;
        for (const room of Object.keys(activeStreams)) {
            if (activeStreams[room] && activeStreams[room].socketId === socket.id) {
                activeStreams[room] = null;
                changed = true;
            }
        }
        if (changed) broadcastRoomsStatus();
    });

    socket.on('sync-webhook', async (payload) => {
        const room = payload.room || 'transmissao1';
        const roomLabel = formatRoomName(room);
        const viewUrl = `${BASE_URL}/${room}`;

        try {
            const base64Data = payload.image.replace(/^data:image\/png;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const formData = new FormData();
            formData.append('file', new Blob([buffer], { type: 'image/png' }), `srt-${room}.png`);

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

            const response = await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
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