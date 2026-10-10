const daExtensao = s => !!(s && s.id === chrome.runtime.id && /^chrome-extension:\/\//.test(s.url || ''));

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
    if (!msg) return false;
    if (msg.acao === 'concorrentes') {
        if (!daExtensao(sender) || !/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) return false;
        lerConcorrentes(String(msg.itemId)).then(responder, () => responder({ ok: false, erro: 'O Mercado Livre não respondeu. Tente de novo em alguns minutos.' }));
        return true;
    }
    // v2.5.3 (D5a): responde logo depois da 1ª batida ({ok, iniciou} — o andamento vem por shc:status). esperar:true = responde o status final.
    if (msg.acao === 'sincronizar') {
        if (!daExtensao(sender)) return false;   // 3.2.1: só as telas da extensão pedem a leitura
        (msg.esperar ? sincronizar('manual') : iniciarSync('manual')).then(responder, () => responder({ ok: false, motivo: 'erro' }));
        return true;
    }
    // v2.5.3 (D6): {acao:'fiscal_agora'} → só a parte fiscal, agora (fiscalAgora).
    if (msg.acao === 'fiscal_agora') {
        if (!daExtensao(sender)) return false;
        fiscalAgora().then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5.3 (D7): {acao:'certificado', dias, data, expirou} ou {acao:'certificado', titulo, texto} da aba do Faturador (conta?: a da página, se souber).
    if (msg.acao === 'certificado') {
        if (!daAbaDoML(sender)) return false;
        // semAviso APAGA o alerta: só com a conta da página e se for a aberta agora. O aviso com texto sem conta ainda vale (a CONFIRMAR AO VIVO se o Faturador traz o id).
        (msg.conta || msg.semAviso ? daContaAtual(msg) : Promise.resolve('ok')).then(ok => (ok ? gravarCertificado(msg) : { ok: false, motivo: 'conta' }))
            .then(responder, () => responder({ ok: false, motivo: 'erro' }));
        return true;
    }
    // v2.5.1: Fechamento, "Tentar agora": {acao:'vendas_brutas_mes', mes:'AAAA-MM'} → lê só esse mês das vendas brutas agora.
    if (msg.acao === 'vendas_brutas_mes') {
        if (!daExtensao(sender)) return false;
        vendasBrutasMes(String(msg.mes || '')).then(responder, () => responder({ ok: false, motivo: 'indisponivel' }));
        return true;
    }
    if (msg.acao === 'sincronizar_custos') {   // botão "Sincronizar custos" das telas da extensão (3.2.1: a aba do ML não pede); erp: 'tiny' (padrão) | 'omie' | 'bling'
        if (!daExtensao(sender)) return false;
        // Sem erp (painel lateral sem Tiny/Omie guardado): o Tiny, ou o Bling se só ele estiver conectado.
        const escolhe = async () => (['tiny', 'omie', 'bling'].indexOf(msg.erp) >= 0 ? msg.erp : (!((await SHC.lerChave(SHC.TINY_CHAVE)) || {}).token && ERPS.bling.cred(await SHC.lerChave(SHC.BLING_CHAVE)) ? 'bling' : 'tiny'));
        escolhe().then(erp => sincronizarCustos(erp, 0).then(responder, () => responder({ ok: false, erp, msg: 'Não consegui falar com o ' + ERPS[erp].nome + '. Tente de novo em alguns minutos.' })));
        return true;
    }
    // v3.2 cruzamento ERP × ML: {acao:'erp_conferir'} ("Conferir agora") refaz erpx:<conta> com o que já está guardado (nenhuma chamada ao ML);
    // {acao:'erp_visto'} a seller fechou a janela do resumo (avisar:false).
    if (msg.acao === 'erp_conferir' || msg.acao === 'erp_visto') {
        if (!daExtensao(sender)) return false;
        (async () => {
            const conta = await SHC.contaAtual();
            // avisar: o Tiny foi conectado pela tela (painel/painel lateral leem o Tiny direto) → todas as contas, com a janela do resumo.
            if (msg.acao === 'erp_conferir' && msg.avisar === true) { await erpConferirTodas({ avisar: true }); return { ok: true, erpx: await SHC.lerChave('erpx:' + conta) }; }
            if (msg.acao === 'erp_conferir') return { ok: true, erpx: await erpConferir(conta) };
            const k = 'erpx:' + conta, x = await SHC.lerChave(k);
            if (x && x.avisar) await SHC.gravarChave(k, Object.assign({}, x, { avisar: false }));
            return { ok: true };
        })().then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'bling_conectar') {   // só o painel (a extensão): o code do launchWebAuthFlow vira tokens aqui no fundo
        if (!daExtensao(sender) || !/^[\w.~-]{4,512}$/.test(String(msg.code || ''))) return false;
        conectarBling(String(msg.code)).then(responder, () => responder({ ok: false, erp: 'bling', msg: 'Não consegui falar com o Bling. Tente de novo.' }));
        return true;
    }
    // F1 (licenca.js): só as telas da própria extensão. 'licenca_entrar': o painel fez o launchWebAuthFlow (state conferido lá) e manda
    // o code + verifier; aqui vira passe + refresh. 'licenca_renovar': renovação única (a mesma promessa do alarme). 'licenca_sair': revoga.
    if (msg.acao === 'licenca_entrar' || msg.acao === 'licenca_renovar' || msg.acao === 'licenca_sair') {
        if (!daExtensao(sender)) return false;
        if (!SHC.licencaTrocarCodigo) { responder({ ok: false, erro: 'desligado' }); return false; }   // 02/10: licenca.js fora do pacote
        let feito;
        if (msg.acao === 'licenca_entrar') {
            if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(msg.code || '')) || !/^[A-Za-z0-9_-]{43,128}$/.test(String(msg.verifier || ''))) return false;
            feito = SHC.licencaTrocarCodigo({ code: String(msg.code), verifier: String(msg.verifier), redirect: SHC.licencaRetorno(chrome.runtime.id) })
                .then(r => { if (r.ok) SHC.licencaAgendar({ ok: true }); return r; });
        } else if (msg.acao === 'licenca_renovar') feito = SHC.licencaRenovar().then(r => { SHC.licencaAgendar(r); return r; });
        else feito = SHC.licencaSair().then(r => { SHC.licencaAgendar(null); return r; });
        feito.then(responder, () => responder({ ok: false, erro: 'indisponivel', msg: 'O SellerHub não respondeu agora. Tente de novo em alguns minutos. O plano Grátis continua funcionando.' }));
        return true;
    }
    if ((msg.acao === 'promos_pagina' && msg.dados) || (msg.acao === 'anuncios_pagina' && Array.isArray(msg.itens))) {
        if (!daAbaDoML(sender)) return false;
        daContaAtual(msg).then(conta => {
            if (!conta) return { ok: false, motivo: 'conta' };   // conta faltando ou de outra conta do mesmo Chrome: descarta
            return msg.acao === 'promos_pagina' ? juntarPagina(conta, msg.dados).then(() => ({ ok: true }))
                : juntarAnuncios(conta, msg.itens, msg.familias, typeof msg.lidoEm === 'number' ? msg.lidoEm : undefined).then(n => ({ ok: true, anuncios: n }));
        }).then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'atacado_degraus' && /^MLB\d{6,14}$/.test(String(msg.itemId || '')) && Array.isArray(msg.degraus)) {   // v3.2: a tela leu os degraus de atacado
        if (!daAbaDoML(sender)) return false;
        daContaAtual(msg).then(conta => (conta ? gravarAtacado(conta, { [msg.itemId]: msg.degraus }).then(() => ({ ok: true })) : { ok: false, motivo: 'conta' }))
            .then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'editor_anuncios' && msg.dados && msg.dados.porItem && typeof msg.dados.porItem === 'object') {   // v3.2: Editor em massa aberto pela seller
        if (!daAbaDoML(sender)) return false;
        daContaAtual(msg).then(conta => (conta ? juntarEditor(conta, msg.dados).then(n => ({ ok: true, lidos: n })) : { ok: false, motivo: 'conta' }))
            .then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'canal_ler_anuncios') {   // v3.1: Agenda do Canal lê os anúncios que o Copiloto ainda não tinha (só GET)
        if (!daExtensao(sender) || !Array.isArray(msg.itemIds)) return false;
        lerAnunciosPorId(msg.itemIds).then(responder, () => responder({ ok: false, lidos: [] }));
        return true;
    }
    if (msg.acao === 'recalcular_alertas') { if (!daExtensao(sender)) return false; atualizarAlertas().then(r => responder({ ok: true, criticos: r.criticos, anomalias: r.anomalias ? r.anomalias.total : null }), () => responder({ ok: false })); return true; }
    if (msg.acao === 'sincronizar_repasse') {   // página de Fechamento, logo depois de o seller conceder a permissão do Mercado Pago
        if (!daExtensao(sender)) return false;
        if (emAndamento) { responder({ ok: false, motivo: 'sincronizando' }); return false; }
        SHC.contaAtual().then(async conta => {
            if (conta !== 'atual' && await confereSessao(conta) === 'outra_conta') return { ok: false, motivo: 'outra_conta' };   // repasse de outra conta não entra nesta
            const r = await sincronizarRepasse(conta, async () => {});
            await emFilaStatus(async () => {
                const st = await SHC.lerStatus();
                Object.assign(st, r.falha ? { erroRepasse: r.falha === 'login' ? 'sem_login_mp' : 'ml_indisponivel' }
                    : { erroRepasse: null, repasseConectado: !r.semPermissao }, r.falha || r.semPermissao ? {} : { repasseEm: Date.now(), repassePaginas: r.paginas });
                await SHC.salvarStatus(st);
            });
            return Object.assign({ ok: !r.falha }, r);
        }).then(responder, () => responder({ ok: false }));
        return true;
    }
    // 3.2.1: a Agenda do Canal abre numa aba pelo fundo (a página dela não fica mais exposta ao ML: sem web_accessible_resources).
    if (msg.acao === 'abrir_agenda') {
        if (!daAbaDoML(sender)) return false;
        chrome.tabs.create({ url: chrome.runtime.getURL('agenda-canal.html') });
        responder({ ok: true });
        return false;
    }
    if (msg.acao === 'abrir_frete' && daAbaDoML(sender) && /^MLB\d{6,14}$/.test(String(msg.itemId || ''))) {
        abrirFrete(String(msg.itemId), sender.tab.id);
        responder({ ok: true });
        return false;
    }
    if (msg.acao === 'simulador') {   // painel lateral: {acao:'simulador', itemId, forcar?} → { ok, sim:{ts, itemId, hoje, outro} }
        if (!daExtensao(sender)) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        simulador(msg.itemId, !!msg.forcar).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5: {acao:'saude_agora', itemId?} → com itemId: lê fotos e visitas do anúncio agora ({ok, itemId, fotos, visitas, radar, semPermissao});
    // sem itemId: começa a rodada lenta ({ok, iniciado} | {ok, emCurso}); o andamento vai em shc:status.saudeProgresso.
    if (msg.acao === 'saude_agora') {
        if (!daExtensao(sender)) return false;
        if (msg.itemId !== undefined && !/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        if (!msg.itemId) {
            const emCurso = !!saudeEmCurso;
            SHC.contaAtual().then(c => rodadaSaude(c)).catch(() => {});
            responder({ ok: true, iniciado: !emCurso, emCurso });
            return false;
        }
        SHC.contaAtual().then(c => saudeAgora(c, String(msg.itemId))).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5.2: {acao:'medidas_agora', itemId} → relê as medidas do anúncio agora (medidasAgora).
    if (msg.acao === 'medidas_agora') {
        if (!daExtensao(sender)) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        SHC.contaAtual().then(c => medidasAgora(c, String(msg.itemId)).then(r => { if (r.ok) atualizarAlertas(c).catch(() => {}); return r; })).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v3.1: {acao:'catalogo_agora', itemId} → compCatAgora (1 GET da tela "Alterar anúncio"; só leitura).
    if (msg.acao === 'catalogo_agora') {
        if (!daExtensao(sender)) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, motivo: 'item' }); return false; }
        SHC.contaAtual().then(c => compCatAgora(c, String(msg.itemId))).then(responder, () => responder({ ok: false, motivo: 'ml_indisponivel' }));
        return true;
    }
    // v2.5.2: {acao:'medidas_marca', itemId, tipo:'alterar'|'fui_eu', em (só no fui_eu)} → medidasMarca.
    if (msg.acao === 'medidas_marca') {
        if (!daExtensao(sender)) return false;
        if (!/^MLB\d{6,14}$/.test(String(msg.itemId || '')) || !/^(alterar|fui_eu)$/.test(String(msg.tipo || '')) || (msg.tipo === 'fui_eu' && !(+msg.em > 0))) {
            responder({ ok: false, motivo: 'item' }); return false;
        }
        SHC.contaAtual().then(c => medidasMarca(c, String(msg.itemId), msg.tipo, +msg.em).then(r => { if (r.ok) atualizarAlertas(c).catch(() => {}); return r; })).then(responder, () => responder({ ok: false, motivo: 'nada' }));
        return true;
    }
    // {acao:'robo_rodar_agora'} → {ok, sugestoes (quantas), feitos:[entradas do histórico], desligado?}
    // {acao:'robo_desfazer', itemId} → a entrada gravada no histórico ({ok, resultado, erro?…}) | {ok:false, resultado:'nada'|'desligado'|'limite'|'semPermissao'|'item'}
    if (msg.acao === 'robo_rodar_agora' || msg.acao === 'robo_desfazer') {
        if (!daExtensao(sender)) return false;
        if (msg.acao === 'robo_desfazer' && !/^MLB\d{6,14}$/.test(String(msg.itemId || ''))) { responder({ ok: false, resultado: 'item' }); return false; }
        SHC.contaAtual().then(c => (msg.acao === 'robo_desfazer' ? roboDesfazer(c, String(msg.itemId)) : roboPassada(c, true)))
            .then(responder, () => responder({ ok: false, resultado: 'falhou' }));
        return true;
    }
    // v2.7: {acao:'resumo_semanal', agora?:true, periodo?:'dia'|'semana' (v3.2; padrão semana)} → {ok, resumo} (guardado; agora = gera de novo com o
    // que está guardado, nenhum GET); {acao:'resumo_semanal_visto'} → tira o "novo" do dia e da semana (o ícone volta ao número das anomalias). Nada é enviado a ninguém.
    if (msg.acao === 'resumo_semanal' || msg.acao === 'resumo_semanal_visto') {
        if (!daExtensao(sender)) return false;
        SHC.contaAtual().then(async c => {
            if (msg.acao === 'resumo_semanal_visto') {
                let mudou = false;
                for (const k of [chaveResumo(c, 'semana'), chaveResumo(c, 'dia')]) { const s = await SHC.lerChave(k); if (s && s.novo) { await SHC.gravarChave(k, Object.assign(s, { novo: false })); mudou = true; } }
                if (mudou) await seloAgora();   // o "•" do robô de promoções continua, se houver
                return { ok: true };
            }
            // Guardado do formato antigo (v2.7, sem periodo: sem emoji nem seções) → gera de novo no formato novo.
            const per = msg.periodo === 'dia' ? 'dia' : 'semana', s = msg.agora ? null : await SHC.lerChave(chaveResumo(c, per));
            return s && s.periodo ? { ok: true, resumo: s } : gerarResumo(c, per, 'pedido');
        }).then(responder, () => responder({ ok: false, motivo: 'erro' }));
        return true;
    }
    // v2.9: {acao:'robopromo_visto'} → o seller viu as sugestões do robô de promoções: tira o ponto do ícone. Nada vai ao ML.
    if (msg.acao === 'robopromo_visto') {
        if (!daExtensao(sender)) return false;
        SHC.contaAtual().then(async c => {
            const k = 'robopromo:' + c, s = await SHC.lerChave(k);
            if (s && s.novo) {
                await SHC.gravarChave(k, Object.assign({}, s, { novo: false }));
                await seloAgora();   // o "•" dos resumos (do dia também) continua
            }
            return { ok: true };
        }).then(responder, () => responder({ ok: false }));
        return true;
    }
    if (msg.acao === 'abrir_painel') { if (!daExtensao(sender)) return false; chrome.runtime.openOptionsPage(); responder({ ok: true }); return false; }
    return false;
});
