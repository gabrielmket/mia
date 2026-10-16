/**
 * FORK MIA (item 8) — as frases de tela dos PAINÉIS PRONTOS, da ANÁLISE DO
 * FUNIL e do LINK PARA O DONO, em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no fim do `DICIONARIO` do upstream por uma
 * linha (`...DICIONARIO_DOS_PAINEIS_MIA`), para a sincronização com o upstream
 * não conflitar a cada frase nova (docs/FORK-MIA.md, regra 1). A chave é o
 * texto em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz: o espalhamento vem por
 * último e VENCERIA a tradução dele em silêncio.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DOS_PAINEIS_MIA: Traducoes = {
  // ── os doze painéis (lib/paineis/catalogo.ts) ──
  "Resultado do mês": { es: "Resultado del mes" },
  "Meta do mês": { es: "Meta del mes" },
  "De onde vêm": { es: "De dónde vienen" },
  "Atendimento: agente e equipe": { es: "Atención: agente y equipo" },
  "Tempo de resposta": { es: "Tiempo de respuesta" },
  Anúncios: { es: "Anuncios" },
  Assuntos: { es: "Temas" },
  "Quanto ganhei, quanto perdi e em quanto tempo fecho?": { es: "¿Cuánto gané, cuánto perdí y en cuánto tiempo cierro?" },
  "Vou bater a meta?": { es: "¿Voy a alcanzar la meta?" },
  "Onde os negócios param?": { es: "¿Dónde se detienen los negocios?" },
  "Qual canal traz quem fecha?": { es: "¿Qué canal trae a quien cierra?" },
  "Qual o motivo das perdas?": { es: "¿Cuál es el motivo de las pérdidas?" },
  "Quanto o agente resolveu sozinho?": { es: "¿Cuánto resolvió el agente solo?" },
  "Quanto o cliente espera?": { es: "¿Cuánto espera el cliente?" },
  "Marcou, confirmou, veio ou faltou?": { es: "¿Agendó, confirmó, vino o faltó?" },
  "Quantos voltaram a responder?": { es: "¿Cuántos volvieron a responder?" },
  "O que foi informado à Meta e ao Google?": { es: "¿Qué se informó a Meta y a Google?" },
  "Quanto deve entrar e quando?": { es: "¿Cuánto debe entrar y cuándo?" },
  "O que mais ocupa o atendimento?": { es: "¿Qué ocupa más la atención?" },

  // ── períodos ──
  "90 dias": { es: "90 días" },
  "Este mês": { es: "Este mes" },
  "últimos 7 dias": { es: "últimos 7 días" },
  "últimos 30 dias": { es: "últimos 30 días" },
  "últimos 90 dias": { es: "últimos 90 días" },
  "este mês, até hoje": { es: "este mes, hasta hoy" },

  // ── rótulos das chaves que o motor devolve ──
  WhatsApp: { es: "WhatsApp" },
  Instagram: { es: "Instagram" },
  Facebook: { es: "Facebook" },
  Integração: { es: "Integración" },
  "Sem funil": { es: "Sin embudo" },
  "Sem profissional": { es: "Sin profesional" },
  "Sem etiqueta": { es: "Sin etiqueta" },
  "Sem motivo": { es: "Sin motivo" },
  "Sem tipo": { es: "Sin tipo" },
  "Sem campanha": { es: "Sin campaña" },
  "Sem canal": { es: "Sin canal" },
  "Sem data": { es: "Sin fecha" },
  "Sem data prevista": { es: "Sin fecha prevista" },
  "Sem origem": { es: "Sin origen" },
  "Sem informação": { es: "Sin información" },
  Venda: { es: "Venta" },
  "Agente resolveu": { es: "El agente resolvió" },
  "Passou para a equipe": { es: "Pasó al equipo" },
  Compareceram: { es: "Asistieron" },
  Faltaram: { es: "Faltaron" },
  Desmarcados: { es: "Cancelados" },
  "Respondeu e fechou": { es: "Respondió y cerró" },
  Encerrado: { es: "Finalizado" },
  Outros: { es: "Otros" },

  // ── os cartões (components/paineis/CartoesDosPaineis.tsx) ──
  "Nada no período.": { es: "Nada en el período." },
  "em negócios ganhos": { es: "en negocios ganados" },
  "Do primeiro contato ao fechamento, em média:": { es: "Del primer contacto al cierre, en promedio:" },
  "negócio(s) em outra moeda ficaram fora da soma.": { es: "negocio(s) en otra moneda quedaron fuera de la suma." },
  "Nenhuma meta cadastrada para este mês.": { es: "No hay meta registrada para este mes." },
  "da meta do mês": { es: "de la meta del mes" },
  "da meta com": { es: "de la meta con" },
  "do mês corrido.": { es: "del mes transcurrido." },
  "No ritmo para bater.": { es: "Al ritmo para alcanzarla." },
  "Abaixo do ritmo.": { es: "Por debajo del ritmo." },
  "seguem adiante": { es: "siguen adelante" },
  "Quantos chegaram a cada etapa, dos que entraram ou fecharam no período.": {
    es: "Cuántos llegaron a cada etapa, de los que entraron o cerraron en el período.",
  },
  fecharam: { es: "cerraron" },
  "Quantos chegaram de cada origem, e quantos viraram venda.": {
    es: "Cuántos llegaron de cada origen, y cuántos se convirtieron en venta.",
  },
  "negócio(s) perdido(s) no período.": { es: "negocio(s) perdido(s) en el período." },
  "das conversas resolvidas pelo agente": { es: "de las conversaciones resueltas por el agente" },
  "conversa(s) com mensagem do cliente no período.": { es: "conversación(es) con mensaje del cliente en el período." },
  "Equipe (metade)": { es: "Equipo (la mitad)" },
  "Equipe (9 em 10)": { es: "Equipo (9 de cada 10)" },
  'Tempo até a primeira resposta. "Metade" quer dizer que metade dos clientes esperou até esse tempo.': {
    es: 'Tiempo hasta la primera respuesta. "La mitad" quiere decir que la mitad de los clientes esperó hasta ese tiempo.',
  },
  realizados: { es: "realizados" },
  Marcados: { es: "Agendados" },
  Confirmados: { es: "Confirmados" },
  Realizados: { es: "Realizados" },
  Faltas: { es: "Ausencias" },
  "de faltas entre os que já aconteceram.": { es: "de ausencias entre los que ya ocurrieron." },
  "desmarcado(s).": { es: "cancelado(s)." },
  "voltaram a responder": { es: "volvieron a responder" },
  Receberam: { es: "Recibieron" },
  "Viraram venda": { es: "Se convirtieron en venta" },
  "Pediram para parar": { es: "Pidieron parar" },
  "Eventos aceitos pela plataforma, do total que o sistema informou (lead qualificado, etapa do funil e venda).": {
    es: "Eventos aceptados por la plataforma, del total que el sistema informó (lead calificado, etapa del embudo y venta).",
  },
  "previstos, pesados pela chance da etapa": { es: "previstos, ponderados por la probabilidad de la etapa" },
  "negócios abertos com chance de fechar": { es: "negocios abiertos con probabilidad de cerrar" },
  "Soma dos negócios abertos, cada um pesado pela chance da etapa em que está.": {
    es: "Suma de los negocios abiertos, cada uno ponderado por la probabilidad de la etapa en que está.",
  },
  "negócio(s) em etapa sem chance calibrada ficaram fora da soma.": {
    es: "negocio(s) en etapa sin probabilidad calibrada quedaron fuera de la suma.",
  },
  "Conversas por etiqueta. Uma conversa com duas etiquetas conta nas duas.": {
    es: "Conversaciones por etiqueta. Una conversación con dos etiquetas cuenta en las dos.",
  },
  "Só gestor e administrador veem o que foi informado aos anúncios.": {
    es: "Solo el gerente y el administrador ven lo que se informó a los anuncios.",
  },
  "Não deu para calcular este painel agora. Tente de novo em instantes.": {
    es: "No se pudo calcular este panel ahora. Inténtalo de nuevo en unos instantes.",
  },

  // ── a tela dos painéis (app/app/paineis) e o atalho em Desempenho ──
  "Painéis prontos": { es: "Paneles listos" },
  "Análise do funil": { es: "Análisis del embudo" },
  "Compartilhar com o dono do negócio": { es: "Compartir con el dueño del negocio" },
  "Ver a análise do funil": { es: "Ver el análisis del embudo" },
  Relatórios: { es: "Informes" },
  "Números somados no banco, com todos os registros do período, no fuso da empresa. Ganhos e perdidos contam pela data em que fecharam; abertos, pela data em que entraram; a agenda, pelo dia marcado.": {
    es: "Números sumados en la base de datos, con todos los registros del período, en la zona horaria de la empresa. Ganados y perdidos cuentan por la fecha en que cerraron; abiertos, por la fecha en que entraron; la agenda, por el día agendado.",
  },
  "Doze painéis do mês: resultado, meta, funil, atendimento, agenda, anúncios e previsão.": {
    es: "Doce paneles del mes: resultado, meta, embudo, atención, agenda, anuncios y previsión.",
  },
  "Um endereço sem senha que mostra ao dono os painéis escolhidos, só com números somados.": {
    es: "Una dirección sin contraseña que muestra al dueño los paneles elegidos, solo con números sumados.",
  },

  // ── os links para o dono (app/app/paineis/links) ──
  "Links para o dono do negócio": { es: "Enlaces para el dueño del negocio" },
  "Um endereço que abre os painéis escolhidos sem usuário nem senha. Mostra só números somados.": {
    es: "Una dirección que abre los paneles elegidos sin usuario ni contraseña. Muestra solo números sumados.",
  },
  "Voltar aos painéis": { es: "Volver a los paneles" },
  "Fechar o novo link": { es: "Cerrar el nuevo enlace" },
  "O link para o dono não está disponível nesta instalação.": {
    es: "El enlace para el dueño no está disponible en esta instalación.",
  },
  "Empresa de demonstração: o link mostra os dados fictícios, com o aviso de demonstração na página. Nada sai daqui.": {
    es: "Empresa de demostración: el enlace muestra los datos ficticios, con el aviso de demostración en la página. Nada sale de aquí.",
  },
  "Para quem é (só para você se organizar)": { es: "Para quién es (solo para que te organices)" },
  "Ex.: Dono da clínica": { es: "Ej.: Dueño de la clínica" },
  Painéis: { es: "Paneles" },
  "A pessoa escolhe": { es: "La persona elige" },
  "Fixo:": { es: "Fijo:" },
  Validade: { es: "Validez" },
  "1 ano": { es: "1 año" },
  "O principal": { es: "El principal" },
  "Mostrar valores em reais": { es: "Mostrar valores en dinero" },
  "Desmarcado, a página mostra só quantidades.": { es: "Desmarcado, la página muestra solo cantidades." },
  "Criar link": { es: "Crear enlace" },
  "Links criados": { es: "Enlaces creados" },
  "Nenhum link ainda.": { es: "Ningún enlace todavía." },
  "O que mostra": { es: "Qué muestra" },
  painéis: { es: "paneles" },
  "com valores em reais": { es: "con valores en dinero" },
  "só quantidades": { es: "solo cantidades" },
  "Revogado em": { es: "Revocado el" },
  "Vale até": { es: "Válido hasta" },
  "ainda não aberto": { es: "aún no abierto" },
  acessos: { es: "accesos" },
  "Ver a página": { es: "Ver la página" },
  "Confirmar: revogar": { es: "Confirmar: revocar" },
  "Renovar por 90 dias": { es: "Renovar por 90 días" },
  "Criar outro igual": { es: "Crear otro igual" },
  "O que o link garante": { es: "Lo que el enlace garantiza" },
  "Mostra só números somados. Nome, telefone e conversa de cliente não saem, nem o nome de quem é da equipe.": {
    es: "Muestra solo números sumados. Nombre, teléfono y conversación de cliente no salen, ni el nombre de quien es del equipo.",
  },
  "Quem tem o endereço vê; por isso ele tem validade e pode ser revogado na hora. Revogado não volta.": {
    es: "Quien tiene la dirección ve; por eso tiene validez y puede revocarse al instante. Revocado no vuelve.",
  },
  "Custo do agente e gasto com anúncio não aparecem: essa conta é da plataforma.": {
    es: "El costo del agente y el gasto en anuncios no aparecen: esa cuenta es de la plataforma.",
  },
  "Cada abertura fica registrada (quando e quantas vezes), sem identificar a pessoa.": {
    es: "Cada apertura queda registrada (cuándo y cuántas veces), sin identificar a la persona.",
  },
  "A página leva o nome da sua empresa.": { es: "La página lleva el nombre de tu empresa." },
  "Diga para quem é o link.": { es: "Indica para quién es el enlace." },
  "Escolha pelo menos um painel.": { es: "Elige al menos un panel." },
  "Link criado e copiado. Mande para quem vai abrir.": { es: "Enlace creado y copiado. Envíalo a quien lo va a abrir." },
  'Link criado. Use "Copiar link" na lista.': { es: 'Enlace creado. Usa "Copiar enlace" en la lista.' },
  "Não deu para copiar sozinho. Abra a página e copie o endereço do navegador.": {
    es: "No se pudo copiar solo. Abre la página y copia la dirección del navegador.",
  },
  "Link revogado: quem abrir vê que não está mais disponível.": {
    es: "Enlace revocado: quien lo abra verá que ya no está disponible.",
  },
  "Link renovado por 90 dias, no mesmo endereço.": { es: "Enlace renovado por 90 días, en la misma dirección." },
  "Confira os campos do link.": { es: "Revisa los campos del enlace." },
  "Link não encontrado.": { es: "Enlace no encontrado." },
  "Ação inválida.": { es: "Acción inválida." },
  "Esse funil não é desta empresa.": { es: "Ese embudo no es de esta empresa." },
  "Link revogado não volta: crie outro, com os mesmos painéis, se quiser dar acesso de novo.": {
    es: "Un enlace revocado no vuelve: crea otro, con los mismos paneles, si quieres dar acceso de nuevo.",
  },
  "Link revogado não volta: crie outro.": { es: "Un enlace revocado no vuelve: crea otro." },
  "O link foi revogado enquanto isso. Crie outro.": { es: "El enlace fue revocado mientras tanto. Crea otro." },
  "Período inválido: use 7, 30, 90 ou mes.": { es: "Período inválido: usa 7, 30, 90 o mes." },
  "Funil inválido.": { es: "Embudo inválido." },
  "Painel desconhecido.": { es: "Panel desconocido." },

  // ── a análise do funil (app/app/paineis/funil) ──
  "Quantos passam de cada etapa, em quanto tempo fecham e de onde vêm os que fecham.": {
    es: "Cuántos pasan de cada etapa, en cuánto tiempo cierran y de dónde vienen los que cierran.",
  },
  "Carregando a análise do funil": { es: "Cargando el análisis del embudo" },
  "Não consegui carregar a análise do funil.": { es: "No pude cargar el análisis del embudo." },
  "O período tem mais registros do que a análise lê de uma vez: os números contam os mais recentes.": {
    es: "El período tiene más registros de los que el análisis lee de una vez: los números cuentan los más recientes.",
  },
  "Conversão etapa a etapa": { es: "Conversión etapa por etapa" },
  entraram: { es: "entraron" },
  "passaram para": { es: "pasaron a" },
  "saltaram ou voltaram de etapa": { es: "saltaron o volvieron de etapa" },
  "já estavam aqui antes do período": { es: "ya estaban aquí antes del período" },
  "A taxa é dos que entraram na etapa dentro do período e passaram para a seguinte.": {
    es: "La tasa es de los que entraron en la etapa dentro del período y pasaron a la siguiente.",
  },
  "Do primeiro contato ao fechamento": { es: "Del primer contacto al cierre" },
  "Metade fecha em até": { es: "La mitad cierra en hasta" },
  "1 em 4 fecha em até": { es: "1 de cada 4 cierra en hasta" },
  "3 em 4 fecham em até": { es: "3 de cada 4 cierran en hasta" },
  "negócio(s) ganho(s) no período. Abertos e perdidos ficam de fora.": {
    es: "negocio(s) ganado(s) en el período. Abiertos y perdidos quedan fuera.",
  },
  "De onde vêm os que fecham": { es: "De dónde vienen los que cierran" },
  "O custo de empurrar a conversão": { es: "El costo de empujar la conversión" },
  "Mensagens até o desfecho (metade / 9 em 10):": { es: "Mensajes hasta el desenlace (la mitad / 9 de cada 10):" },
  "Pediram para não receber mais mensagens:": { es: "Pidieron no recibir más mensajes:" },

  // ── a página pública (app/painel/[token]) ──
  "Aguarde um minuto e abra o link de novo.": { es: "Espera un minuto y abre el enlace de nuevo." },
  "Painel de resultados": { es: "Panel de resultados" },
  "Abra o link para ver o painel.": { es: "Abre el enlace para ver el panel." },
  Resultados: { es: "Resultados" },
  "atualizado às": { es: "actualizado a las" },
  "Demonstração: os números desta página são de dados fictícios.": {
    es: "Demostración: los números de esta página son de datos ficticios.",
  },
  "Números somados, sem dados pessoais de clientes.": { es: "Números sumados, sin datos personales de clientes." },
  "Link válido até": { es: "Enlace válido hasta" },
  "Este link não está disponível": { es: "Este enlace no está disponible" },
  "Ele pode ter vencido ou ter sido encerrado por quem enviou. Peça um link novo a quem mandou.": {
    es: "Puede haber vencido o haber sido cerrado por quien lo envió. Pide un enlace nuevo a quien lo mandó.",
  },
};
