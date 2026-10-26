/**
 * FORK MIA (.88) — as frases do ASSISTENTE DA MIA (o painel, a página, os
 * chamados, o resumo da manhã, o ponto de IA e as rotas), em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha
 * (`...DICIONARIO_DO_ASSISTENTE_MIA`), para a sincronização com o upstream não
 * conflitar a cada frase nova (docs/FORK-MIA.md, regra 1). A chave é o texto
 * em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DO_ASSISTENTE_MIA: Traducoes = {
  // ── a porta e o catálogo de navegação ──
  "Pergunte do seu jeito: a sua rotina, os seus números e como usar o sistema, com o que você já pode ver.": {
    es: "Pregunta a tu manera: tu rutina, tus números y cómo usar el sistema, con lo que ya puedes ver.",
  },

  // ── o ponto de IA (lib/ai/pontos/registro.ts) ──
  "Responder a equipe no assistente": { es: "Responder al equipo en el asistente" },
  "Responde às perguntas da equipe no assistente da MIA: a rotina do dia, as prioridades, os leads, a performance e como usar o sistema, com os mesmos números das telas e só o que cada pessoa já vê. Nunca fala com o cliente nem muda nada no sistema.":
    {
      es: "Responde las preguntas del equipo en el asistente de MIA: la rutina del día, las prioridades, los leads, el desempeño y cómo usar el sistema, con los mismos números de las pantallas y solo lo que cada persona ya ve. Nunca habla con el cliente ni cambia nada en el sistema.",
    },
  "A pessoa pergunta ao assistente e recebe só o aviso de que ele não conseguiu responder agora; os números continuam nas telas.":
    {
      es: "La persona le pregunta al asistente y solo recibe el aviso de que no pudo responder ahora; los números siguen en las pantallas.",
    },

  // ── o painel ──
  "Você está em": { es: "Estás en" },
  Olá: { es: "Hola" },
  "Sou o assistente da MIA. Posso te mostrar sua rotina e seus números, e te ajudar a usar o sistema.": {
    es: "Soy el asistente de MIA. Puedo mostrarte tu rutina y tus números, y ayudarte a usar el sistema.",
  },
  "Eu vejo só o que você já pode ver": { es: "Solo veo lo que tú ya puedes ver" },
  "tudo da empresa, inclusive a configuração": { es: "todo de la empresa, incluida la configuración" },
  "a equipe inteira; configura funis, follow-ups e automações": {
    es: "todo el equipo; configura embudos, seguimientos y automatizaciones",
  },
  "os próprios negócios, conversas, tarefas e metas": { es: "tus propios negocios, conversaciones, tareas y metas" },
  "o que a sua conta somente leitura mostra": { es: "lo que muestra tu cuenta de solo lectura" },
  "Consultando o sistema com o seu acesso…": { es: "Consultando el sistema con tu acceso…" },
  "O assistente está desligado para o seu papel nesta empresa.": {
    es: "El asistente está apagado para tu rol en esta empresa.",
  },
  "Pergunte do seu jeito": { es: "Pregunta a tu manera" },
  "Sua pergunta": { es: "Tu pregunta" },
  "Sua rotina, seus números e como usar o sistema, com o que você já pode ver.": {
    es: "Tu rutina, tus números y cómo usar el sistema, con lo que ya puedes ver.",
  },
  "Abrir o histórico": { es: "Abrir el historial" },
  "Como está minha rotina hoje?": { es: "¿Cómo está mi rutina hoy?" },
  "Por onde eu começo?": { es: "¿Por dónde empiezo?" },
  "Como estão meus leads?": { es: "¿Cómo están mis leads?" },
  "Como está minha performance no mês?": { es: "¿Cómo va mi desempeño en el mes?" },
  "Quanto a equipe vendeu no mês?": { es: "¿Cuánto vendió el equipo en el mes?" },
  "Por que a IA não respondeu um cliente?": { es: "¿Por qué la IA no le respondió a un cliente?" },
  "Como configuro o horário da IA?": { es: "¿Cómo configuro el horario de la IA?" },
  "Encontrei um erro": { es: "Encontré un error" },
  "Não consegui responder agora.": { es: "No pude responder ahora." },

  // ── a mensagem e os botões ──
  "Resposta da Time Company": { es: "Respuesta de Time Company" },
  "Resumo da manhã": { es: "Resumen de la mañana" },
  "Me leva lá": { es: "Llévame allí" },
  "Mandar ao suporte": { es: "Enviar a soporte" },
  "Pedido enviado pela Central de avisos para": { es: "Pedido enviado por la Central de avisos a" },
  "Não deu para mandar o pedido agora.": { es: "No se pudo enviar el pedido ahora." },
  "Pedir a": { es: "Pedirle a" },
  "Pergunta enviada ao suporte da Time. Chamado": { es: "Pregunta enviada al soporte de Time. Ticket" },
  "Enviada ao suporte": { es: "Enviada a soporte" },
  // as fontes ("de onde veio")
  "Caixa de entrada": { es: "Bandeja de entrada" },
  "Relatórios: meus negócios": { es: "Informes: mis negocios" },
  "Relatórios: negócios por responsável": { es: "Informes: negocios por responsable" },
  "Manual do sistema": { es: "Manual del sistema" },
  "Guia de operação": { es: "Guía de operación" },
  "Mapa das telas": { es: "Mapa de las pantallas" },
  "Como trabalhamos aqui": { es: "Cómo trabajamos aquí" },
  "Registro do que a IA fez em cada mensagem": { es: "Registro de lo que hizo la IA en cada mensaje" },
  Chamados: { es: "Tickets" },

  // ── o chamado ──
  "Que bom. Se acontecer de novo, é só me chamar.": { es: "Qué bien. Si vuelve a pasar, solo llámame." },
  Chamado: { es: "Ticket" },
  "aberto. A resposta da Time chega aqui no assistente e no seu e-mail.": {
    es: "abierto. La respuesta de Time llega aquí en el asistente y en tu correo.",
  },
  "Chamado que vou abrir": { es: "Ticket que voy a abrir" },
  "Parece só um campo faltando, e não um erro do sistema. Se quiser, abro o chamado mesmo assim.": {
    es: "Parece solo un campo que falta, y no un error del sistema. Si quieres, abro el ticket de todos modos.",
  },
  "O que você disse": { es: "Lo que dijiste" },
  "O que eu junto": { es: "Lo que adjunto" },
  tela: { es: "pantalla" },
  "a hora": { es: "la hora" },
  "a versão do sistema": { es: "la versión del sistema" },
  "o navegador": { es: "el navegador" },
  "mensagem do sistema": { es: "mensaje del sistema" },
  "Trocar o print": { es: "Cambiar la captura" },
  "Anexar print": { es: "Adjuntar captura" },
  "Abrir o chamado": { es: "Abrir el ticket" },
  "Resolvi, obrigado": { es: "Lo resolví, gracias" },
  "Demonstração: não enviado": { es: "Demostración: no enviado" },

  // ── a página ──
  "Pergunte do seu jeito: a sua rotina, os seus números e como usar o sistema. O assistente vê só o que você já pode ver.":
    {
      es: "Pregunta a tu manera: tu rutina, tus números y cómo usar el sistema. El asistente ve solo lo que tú ya puedes ver.",
    },
  "Seções do assistente": { es: "Secciones del asistente" },
  "Na empresa": { es: "En la empresa" },
  "Nenhuma conversa ainda.": { es: "Ninguna conversación todavía." },
  "O histórico fica guardado por 90 dias. Só você vê as suas conversas.": {
    es: "El historial se guarda 90 días. Solo tú ves tus conversaciones.",
  },
  "Resumo da manhã ligado.": { es: "Resumen de la mañana activado." },
  "Resumo da manhã desligado.": { es: "Resumen de la mañana desactivado." },
  "Não deu para guardar a escolha agora.": { es: "No se pudo guardar la elección ahora." },
  "Em dia útil, às 8h no fuso da empresa, o plano do dia fica pronto aqui no assistente e aparece um aviso no sino.": {
    es: "En día hábil, a las 8 h en la zona horaria de la empresa, el plan del día queda listo aquí en el asistente y aparece un aviso en la campana.",
  },
  "O resumo é montado pelo próprio sistema, sem gastar IA: os compromissos, as tarefas, as conversas esperando e a ordem do que mais rende hoje.":
    {
      es: "El resumen lo arma el propio sistema, sin gastar IA: los compromisos, las tareas, las conversaciones en espera y el orden de lo que más rinde hoy.",
    },
  "Erros, dúvidas e pedidos que você mandou para a Time Company pelo assistente. A resposta chega aqui e no seu e-mail.": {
    es: "Errores, dudas y pedidos que enviaste a Time Company por el asistente. La respuesta llega aquí y a tu correo.",
  },
  "Nenhum chamado ainda.": { es: "Ningún ticket todavía." },
  "Não deu para ler a configuração do assistente agora.": { es: "No se pudo leer la configuración del asistente ahora." },
  "Quem usa o assistente foi atualizado.": { es: "Se actualizó quién usa el asistente." },
  "Não deu para guardar a configuração agora.": { es: "No se pudo guardar la configuración ahora." },
  "O que você escrever aqui o assistente usa nas respostas a toda a equipe. Ex.: proposta acima de R$ 10 mil passa pela gestora.": {
    es: "Lo que escribas aquí el asistente lo usa en las respuestas a todo el equipo. Ej.: una propuesta de más de R$ 10 mil pasa por la gerente.",
  },
  "Guardado.": { es: "Guardado." },
  "Como a empresa faz isso": { es: "Cómo lo hace la empresa" },
  "Nada escrito ainda.": { es: "Nada escrito todavía." },
  "Quem usa": { es: "Quién lo usa" },
  "O assistente está desligado nesta empresa pela Time Company.": {
    es: "Time Company apagó el asistente en esta empresa.",
  },
  "Limite de perguntas por pessoa por dia": { es: "Límite de preguntas por persona por día" },
  "A IA é da plataforma; para mudar o limite, fale com a Time Company.": {
    es: "La IA es de la plataforma; para cambiar el límite, habla con Time Company.",
  },
  "Perguntas que ficaram sem resposta": { es: "Preguntas que quedaron sin respuesta" },
  "Para melhorar a ajuda: o que o assistente não soube responder nos últimos 30 dias, sem o resto da conversa de ninguém.": {
    es: "Para mejorar la ayuda: lo que el asistente no supo responder en los últimos 30 días, sin el resto de la conversación de nadie.",
  },
  vez: { es: "vez" },
  vezes: { es: "veces" },
  "Nenhuma por enquanto.": { es: "Ninguna por ahora." },

  // ── as rotas ──
  "Não deu para abrir o histórico do assistente agora.": { es: "No se pudo abrir el historial del asistente ahora." },
  "O assistente está desligado para o seu papel nesta empresa": { es: "El asistente está apagado para tu rol en esta empresa" },
  "Você chegou ao limite de perguntas ao assistente por hoje. Amanhã ele volta a responder.": {
    es: "Llegaste al límite de preguntas al asistente por hoy. Mañana vuelve a responder.",
  },
  "Não deu para abrir a conversa com o assistente agora.": { es: "No se pudo abrir la conversación con el asistente ahora." },
  "Não deu para guardar a pergunta agora.": { es: "No se pudo guardar la pregunta ahora." },
  "A IA do assistente ainda não está configurada nesta instalação. Avise a Time Company.": {
    es: "La IA del asistente todavía no está configurada en esta instalación. Avísale a Time Company.",
  },
  "Não consegui responder agora. Tente de novo em instantes; os números continuam nas telas.": {
    es: "No pude responder ahora. Inténtalo de nuevo en un momento; los números siguen en las pantallas.",
  },
  "Não deu para ler os chamados agora.": { es: "No se pudieron leer los tickets ahora." },
  "O print passa de 10 MB.": { es: "La captura supera los 10 MB." },
  "O print precisa ser uma imagem PNG, JPG ou WEBP.": { es: "La captura tiene que ser una imagen PNG, JPG o WEBP." },
  "O arquivo do print veio vazio.": { es: "El archivo de la captura llegó vacío." },
  "Chamado inválido.": { es: "Ticket inválido." },
  "Não deu para abrir o chamado agora.": { es: "No se pudo abrir el ticket ahora." },
  "Esta é a empresa de demonstração: o chamado fica registrado aqui, mas não sai para a Time Company.": {
    es: "Esta es la empresa de demostración: el ticket queda registrado aquí, pero no sale hacia Time Company.",
  },
  "Chamado não encontrado.": { es: "Ticket no encontrado." },
  "Este chamado não tem print.": { es: "Este ticket no tiene captura." },
  "Erro ao abrir o print.": { es: "Error al abrir la captura." },
  "Pedido inválido.": { es: "Pedido inválido." },
  "Escolha outra pessoa da equipe.": { es: "Elige a otra persona del equipo." },
  "Muitos pedidos seguidos. Tente daqui a pouco.": { es: "Demasiados pedidos seguidos. Inténtalo en un rato." },
  "Essa pessoa não está na equipe.": { es: "Esa persona no está en el equipo." },
  "Alguém da equipe": { es: "Alguien del equipo" },
  "pediu pelo assistente": { es: "pidió por el asistente" },
  "Na tela": { es: "En la pantalla" },
  "Item inválido.": { es: "Ítem inválido." },
  "Não deu para guardar agora.": { es: "No se pudo guardar ahora." },
  "Diga qual item tirar.": { es: "Di qué ítem quitar." },
  "Não deu para tirar agora.": { es: "No se pudo quitar ahora." },
  "A base da empresa cabe até 30 itens.": { es: "La base de la empresa admite hasta 30 ítems." },
  "O título precisa ter de 1 a 120 caracteres.": { es: "El título tiene que tener de 1 a 120 caracteres." },
  "O texto precisa ter de 1 a 2000 caracteres.": { es: "El texto tiene que tener de 1 a 2000 caracteres." },

  // ── as prioridades e o resumo da manhã ──
  'Religar o número "{nome}": enquanto ele estiver desconectado, nada que chega por ele é visto.': {
    es: 'Reconectar el número "{nome}": mientras esté desconectado, nada de lo que llega por él se ve.',
  },
  "{n} conversas esperam resposta; a mais antiga, de {contato}, há {tempo}.": {
    es: "{n} conversaciones esperan respuesta; la más antigua, de {contato}, hace {tempo}.",
  },
  "Responder {contato}: espera há {tempo}.": { es: "Responder a {contato}: espera hace {tempo}." },
  "{n} h": { es: "{n} h" },
  "{n} dias": { es: "{n} días" },
  "Dar dono às {n} conversas abertas sem ninguém responsável.": {
    es: "Asignar responsable a las {n} conversaciones abiertas sin nadie a cargo.",
  },
  "Abrir conversas": { es: "Abrir conversaciones" },
  "{n} compromissos hoje; o primeiro: {titulo}, {quando}.": { es: "{n} citas hoy; la primera: {titulo}, {quando}." },
  "Ver a agenda": { es: "Ver la agenda" },
  "{n} tarefas atrasadas na equipe; {nome} tem {m} delas.": { es: "{n} tareas atrasadas en el equipo; {nome} tiene {m}." },
  "{n} tarefas atrasadas para destravar.": { es: "{n} tareas atrasadas para destrabar." },
  "Abrir tarefas": { es: "Abrir tareas" },
  "{n} negócios em risco: sem movimento além da janela da etapa.": {
    es: "{n} negocios en riesgo: sin movimiento más allá de la ventana de la etapa.",
  },
  "Ver no Radar": { es: "Ver en el Radar" },
  "Meta do mês: faltam {falta} ({pct}% feito).": { es: "Meta del mes: faltan {falta} ({pct}% hecho)." },
  "Ver desempenho": { es: "Ver desempeño" },
  "Bom dia, {nome}. Seu plano para hoje:": { es: "Buenos días, {nome}. Tu plan para hoy:" },
  "{agenda} compromissos · {tarefas} tarefas de hoje · {atrasadas} atrasadas · {conversas} conversas esperando resposta": {
    es: "{agenda} citas · {tarefas} tareas de hoy · {atrasadas} atrasadas · {conversas} conversaciones esperando respuesta",
  },
  "Nada pendente por enquanto. Bom trabalho.": { es: "Nada pendiente por ahora. Buen trabajo." },
  "Eu ordeno por: algo parado na empresa, cliente esperando, compromisso do dia, atraso e meta.": {
    es: "Ordeno por: algo detenido en la empresa, cliente esperando, compromiso del día, atraso y meta.",
  },
  "Seu resumo da manhã está pronto no assistente.": { es: "Tu resumen de la mañana está listo en el asistente." },

  Metas: { es: "Metas" },
  Guardar: { es: "Guardar" },

  // ── o admin da plataforma: os chamados (components/admin/chamados) ──
  "Chamados do assistente": { es: "Tickets del asistente" },
  "Erros, dúvidas e pedidos que as equipes dos clientes abriram pelo assistente da MIA, com o que o assistente juntou.": {
    es: "Errores, dudas y pedidos que los equipos de los clientes abrieron por el asistente de MIA, con lo que el asistente adjuntó.",
  },
  "Não consegui ler os chamados.": { es: "No pude leer los tickets." },
  "Nenhum chamado neste filtro.": { es: "Ningún ticket en este filtro." },
  "Quem abriu": { es: "Quién lo abrió" },
  Tela: { es: "Pantalla" },
  Hora: { es: "Hora" },
  "Mensagem do sistema": { es: "Mensaje del sistema" },
  "Abrir o print": { es: "Abrir la captura" },
  "Resposta para quem abriu": { es: "Respuesta para quien lo abrió" },
  "Ao salvar uma resposta nova, ou ao resolver, quem abriu recebe no assistente, no sino e no e-mail.": {
    es: "Al guardar una respuesta nueva, o al resolver, quien lo abrió la recibe en el asistente, en la campana y por correo.",
  },
  assistente: { es: "asistente" },
  sino: { es: "campana" },
  "e-mail": { es: "correo" },
  "Salvo. Chegou por": { es: "Guardado. Llegó por" },
  "Não consegui gravar a resposta.": { es: "No pude guardar la respuesta." },

  // ── os botões dos avisos do sino (lib/ai/inbox-destino.ts) ──
  "Ver a resposta": { es: "Ver la respuesta" },
  "Abrir o resumo": { es: "Abrir el resumen" },

  // ── a resposta do chamado (assistente, sino e e-mail) ──
  "Seu chamado #{n} foi resolvido.": { es: "Tu ticket #{n} fue resuelto." },
  "A Time Company respondeu o seu chamado #{n} ({s}).": { es: "Time Company respondió tu ticket #{n} ({s})." },
  "Chamado #{n}": { es: "Ticket #{n}" },
  "Assistente da MIA": { es: "Asistente de MIA" },
  "Chamado #{n}: a resposta da Time Company": { es: "Ticket #{n}: la respuesta de Time Company" },
  "Situação: {s}": { es: "Situación: {s}" },
  "A resposta também está no assistente da MIA, em Chamados.": {
    es: "La respuesta también está en el asistente de MIA, en Tickets.",
  },
  "Abrir o assistente": { es: "Abrir el asistente" },
};
