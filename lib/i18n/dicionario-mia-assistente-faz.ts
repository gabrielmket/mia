/**
 * FORK MIA (.94) — as frases do "FAZ COM APROVAÇÃO" do assistente (o cartão
 * da proposta, a aba Propostas e o catálogo das peças), em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha
 * (`...DICIONARIO_DO_ASSISTENTE_FAZ_MIA`), para a sincronização com o upstream
 * não conflitar a cada frase nova (docs/FORK-MIA.md, regra 1). A chave é o
 * texto em português.
 *
 * ⚠️ Não repita aqui uma chave que outro dicionário já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DO_ASSISTENTE_FAZ_MIA: Traducoes = {
  // o cartão
  seguro: { es: "seguro" },
  "Onde:": { es: "Dónde:" },
  "Atualizando...": { es: "Actualizando..." },
  "Pronto, atualiza o cartão": { es: "Listo, actualiza la tarjeta" },
  "Proposta recusada. Nada mudou.": { es: "Propuesta rechazada. Nada cambió." },
  "Aplicado. A tela já mostra o que mudou.": { es: "Aplicado. La pantalla ya muestra lo que cambió." },
  "Não deu para fazer isso agora.": { es: "No se pudo hacer eso ahora." },
  "Cartão atualizado: é isso que vai ser gravado.": { es: "Tarjeta actualizada: esto es lo que se va a guardar." },
  "Quem aprova:": { es: "Quién aprueba:" },
  "Desfazer:": { es: "Deshacer:" },
  "Pedido por": { es: "Pedido por" },
  "vê no assistente e no sino.": { es: "lo ve en el asistente y en la campana." },
  "Pedido enviado a": { es: "Pedido enviado a" },
  "com o cartão pronto.": { es: "con la tarjeta lista." },
  "Fechar o ajuste": { es: "Cerrar el ajuste" },
  Esperando: { es: "Esperando a" },
  "Quem aprova decide no assistente dele.": { es: "Quien aprueba decide en su asistente." },
  "Aplicada por": { es: "Aplicada por" },
  'Entrou no registro como "via assistente".': { es: 'Quedó en el registro como "vía asistente".' },
  "Não dá mais para desfazer:": { es: "Ya no se puede deshacer:" },
  "Me leva até a tela": { es: "Llévame a la pantalla" },
  "Ver na tela": { es: "Ver en la pantalla" },
  "Já estava desfeita.": { es: "Ya estaba deshecha." },
  "Desfeito. A tela voltou a ser como era.": { es: "Deshecho. La pantalla volvió a ser como era." },
  "Desfazendo...": { es: "Deshaciendo..." },
  Desfazer: { es: "Deshacer" },
  "Desfeita por": { es: "Deshecha por" },
  "A tela voltou a ser como era.": { es: "La pantalla volvió a ser como era." },
  "Recusada por": { es: "Rechazada por" },
  "Nada mudou.": { es: "Nada cambió." },
  "Venceu sem decisão. Nada mudou.": { es: "Venció sin decisión. Nada cambió." },

  // o que muda (os rótulos que o servidor manda)
  Antes: { es: "Antes" },
  Depois: { es: "Después" },
  Atalho: { es: "Atajo" },
  Para: { es: "Para" },
  "1ª": { es: "1.ª" },
  "2ª": { es: "2.ª" },
  "3ª": { es: "3.ª" },
  Material: { es: "Material" },
  Relatório: { es: "Informe" },
  "Quem vê": { es: "Quién lo ve" },

  // o catálogo das peças
  "Criar etapa do funil": { es: "Crear etapa del embudo" },
  "Renomear etapa do funil": { es: "Renombrar etapa del embudo" },
  "Rascunho de follow-up": { es: "Borrador de seguimiento" },
  "Item de conhecimento": { es: "Ítem de conocimiento" },
  "Agente do modelo do segmento": { es: "Agente del modelo del segmento" },
  "Funil do quadro pronto": { es: "Embudo del tablero listo" },
  "Follow-up do modelo": { es: "Seguimiento del modelo" },
  "Configurações › Etiquetas": { es: "Configuración › Etiquetas" },
  "Agente MIA › Follow-ups": { es: "Agente MIA › Seguimientos" },
  "Agente MIA › Conhecimento": { es: "Agente MIA › Conocimiento" },
  "Agente MIA › Agentes": { es: "Agente MIA › Agentes" },
  "enquanto a etapa estiver vazia": { es: "mientras la etapa esté vacía" },
  "enquanto ninguém mudar o nome de novo: volta o nome antigo": { es: "mientras nadie cambie el nombre otra vez: vuelve el nombre anterior" },
  "enquanto ninguém editar a resposta": { es: "mientras nadie edite la respuesta" },
  "enquanto nenhum contato, negócio ou conversa tiver a etiqueta": { es: "mientras ningún contacto, negocio o conversación tenga la etiqueta" },
  "enquanto a tarefa não for concluída": { es: "mientras la tarea no esté concluida" },
  "enquanto o rascunho não for publicado": { es: "mientras el borrador no se publique" },
  "sempre: o item sai na hora": { es: "siempre: el ítem sale en el momento" },
  "enquanto não estiver num painel": { es: "mientras no esté en un panel" },
  "enquanto ninguém mudar a meta pela tela: volta a anterior": { es: "mientras nadie cambie la meta en la pantalla: vuelve la anterior" },
  "enquanto for rascunho": { es: "mientras sea borrador" },
  "enquanto nenhum negócio entrar": { es: "mientras no entre ningún negocio" },
  "enquanto não sair com o agente publicado": { es: "mientras no salga con el agente publicado" },
  "As automações e o agente que usam esta etapa seguem funcionando: eles olham a etapa, não o nome.": {
    es: "Las automatizaciones y el agente que usan esta etapa siguen funcionando: miran la etapa, no el nombre.",
  },
  "Nasce em rascunho: nenhuma mensagem sai. Publicar é na tela, clique de quem pode.": {
    es: "Nace en borrador: no sale ningún mensaje. Publicar es en la pantalla, con el clic de quien puede.",
  },
  "Muda o que a equipe vê em Desempenho e no resumo da manhã. Pelo assistente, só o administrador aprova a meta.": {
    es: "Cambia lo que el equipo ve en Desempeño y en el resumen de la mañana. Por el asistente, solo el administrador aprueba la meta.",
  },
  "Nasce em rascunho: não responde ninguém até alguém publicar.": { es: "Nace en borrador: no responde a nadie hasta que alguien lo publique." },
  "Nasce em rascunho e sai junto com o agente na próxima publicação.": { es: "Nace en borrador y sale junto con el agente en la próxima publicación." },

  // quem aprova
  "só o administrador": { es: "solo el administrador" },
  "gestor ou administrador": { es: "gestor o administrador" },
  "quem pediu: é só dela": { es: "quien lo pidió: es solo suyo" },
  "quem pediu, ou gestor e administrador": { es: "quien lo pidió, o gestor y administrador" },

  // o ajuste
  "Fica antes de": { es: "Queda antes de" },
  "2ª mensagem": { es: "2.º mensaje" },
  "3ª mensagem": { es: "3.º mensaje" },
  Intervalo: { es: "Intervalo" },
  origem: { es: "origen" },
  etapa: { es: "etapa" },
  "pessoa da equipe": { es: "persona del equipo" },
  "nos últimos 7 dias": { es: "en los últimos 7 días" },
  "nos últimos 30 dias": { es: "en los últimos 30 días" },
  "nos últimos 90 dias": { es: "en los últimos 90 días" },
  "neste mês": { es: "en este mes" },
  "no mês passado": { es: "en el mes pasado" },
  "só quem pediu": { es: "solo quien lo pidió" },
  "toda a equipe": { es: "todo el equipo" },
  "1 dia e depois 3 dias": { es: "1 día y después 3 días" },
  "2 dias e depois 4 dias": { es: "2 días y después 4 días" },
  "2 dias e depois 5 dias": { es: "2 días y después 5 días" },
  "3 dias e depois 7 dias": { es: "3 días y después 7 días" },

  // a aba Propostas
  "Não deu para ler as propostas agora.": { es: "No se pudieron leer las propuestas ahora." },
  "Pedidos esperando você": { es: "Pedidos que te esperan" },
  "Nenhum pedido agora. Quando alguém da equipe pedir algo que você aprova, o cartão pronto chega aqui e no sino.": {
    es: "Ningún pedido ahora. Cuando alguien del equipo pida algo que tú apruebas, la tarjeta lista llega aquí y a la campana.",
  },
  "Seus pedidos": { es: "Tus pedidos" },
  "Quando você pede algo que não aprova, o cartão vai pronto para quem aprova, e o resultado volta para você aqui.": {
    es: "Cuando pides algo que no apruebas, la tarjeta va lista a quien aprueba, y el resultado vuelve a ti aquí.",
  },
  "Como o cartão funciona": { es: "Cómo funciona la tarjeta" },
  'Nada muda antes do "Aprovar e aplicar". O assistente só lê e prepara.': {
    es: 'Nada cambia antes de "Aprobar y aplicar". El asistente solo lee y prepara.',
  },
  "Um cartão é uma peça. Pedir de novo a mesma coisa devolve o mesmo cartão.": {
    es: "Una tarjeta es una pieza. Pedir de nuevo lo mismo devuelve la misma tarjeta.",
  },
  "Aprova quem pode fazer a mesma coisa na tela. A meta do mês e as peças do modelo são só do administrador.": {
    es: "Aprueba quien puede hacer lo mismo en la pantalla. La meta del mes y las piezas del modelo son solo del administrador.",
  },
  "Desfazer não é apagar: tira só o que a proposta fez, e só enquanto nada depende disso.": {
    es: "Deshacer no es borrar: quita solo lo que hizo la propuesta, y solo mientras nada dependa de eso.",
  },
  "Número, cobrança, convite, papéis, chaves, apagar, publicar agente e mensagem a cliente o assistente nunca faz: ele explica e leva até a tela.": {
    es: "Número, cobro, invitación, roles, claves, borrar, publicar agente y mensaje a cliente el asistente nunca los hace: explica y lleva a la pantalla.",
  },
  "Proposta que ninguém decide vence em 30 dias e não muda nada.": { es: "La propuesta que nadie decide vence en 30 días y no cambia nada." },
  "O que o assistente fez": { es: "Lo que hizo el asistente" },
  'Tudo o que for aplicado aparece aqui, com quem aprovou e o "Desfazer". Fica também no Audit Log, como "via assistente".': {
    es: 'Todo lo que se aplique aparece aquí, con quién lo aprobó y el "Deshacer". También queda en el Audit Log, como "vía asistente".',
  },
};
