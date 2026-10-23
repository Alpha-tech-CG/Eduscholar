import type { HelpContent } from "./types";

// Ajuda em português (norma europeia, Acordo Ortográfico de 1990). Cada frase
// descreve o que a aplicação faz hoje: nenhuma promessa que não cumpra.

export const pt: HelpContent = {
  index: {
    title: "Ajuda",
    intro:
      "Como utilizar o EduScholar: a sua conta, o catálogo, a sua biblioteca, o seu projeto de investigação, a partilha com um orientador, as ligações fracas e os seus dados.",
    topicsHeading: "Temas",
    note: "Estas páginas descrevem a plataforma tal como funciona hoje. Está ainda em construção: algumas funções vão mudar.",
  },
  backToIndex: "Voltar à ajuda",
  relatedHeading: "Para saber mais",
  topics: {
    account: {
      title: "Criar a sua conta e proteger o início de sessão",
      summary: "Registo, confirmação do endereço, perfil, palavra-passe esquecida e verificação em dois passos.",
      sections: [
        {
          heading: "Criar uma conta",
          paragraphs: [
            "Escolha um endereço de correio eletrónico e uma palavra-passe com, pelo menos, doze caracteres, com letras e algarismos. Uma palavra-passe demasiado comum, ou que conste de fugas de dados conhecidas, é recusada. Pode ser-lhe pedida uma verificação anti-robô.",
            "É enviada uma mensagem para o endereço indicado. Abra a ligação que contém para ativar a sua conta e, depois, inicie sessão.",
            "No primeiro início de sessão, preenche um perfil mínimo: país, nível de estudos e curso, e a declaração de que tem a idade exigida no seu país. Estas informações adaptam a pesquisa; só o próprio as vê.",
          ],
          links: [
            { href: "/sign-up", label: "Criar uma conta" },
            { href: "/sign-in", label: "Iniciar sessão" },
          ],
        },
        {
          heading: "Palavra-passe esquecida",
          paragraphs: [
            "Na página de início de sessão, peça uma ligação para escolher uma nova palavra-passe. A mensagem só chega se existir uma conta para esse endereço. Depois de alterada a palavra-passe, todos os seus dispositivos terminam a sessão.",
          ],
          links: [{ href: "/forgot-password", label: "Palavra-passe esquecida" }],
        },
        {
          heading: "A verificação em dois passos",
          paragraphs: [
            "Além da palavra-passe, pede um código de seis algarismos mostrado por uma aplicação de autenticação instalada no seu telemóvel. Ative-a em «Segurança da conta»: leia o código apresentado, ou introduza a chave manualmente, e depois o primeiro código.",
            "Gere de imediato os seus dez códigos de recuperação e guarde-os noutro sítio que não esse telemóvel. Cada um só serve uma vez. Se perder a aplicação, um código de recuperação devolve-lhe o acesso; a verificação em dois passos fica então desativada e as suas outras sessões são encerradas: volte a ativá-la com o novo dispositivo.",
            "As funções de moderação e de administração exigem a verificação em dois passos.",
          ],
          links: [{ href: "/account/security", label: "Segurança da conta" }],
        },
      ],
    },
    search: {
      title: "Pesquisar no catálogo e compreender uma ficha",
      summary: "A pesquisa, os seus filtros e o que dizem a origem, a licença e o estado de acesso de uma ficha.",
      sections: [
        {
          heading: "Pesquisar",
          paragraphs: [
            "A pesquisa está aberta às contas com o perfil preenchido. Escreva algumas palavras e, depois, restrinja por tipo de documento, língua, estado de acesso, nível ou disciplina do seu curso.",
            "Só aparecem as fichas publicadas pela moderação: uma proposta em apreciação não é mostrada a ninguém.",
            "A página «Recomendações» sugere fichas com base apenas no seu perfil e, se o desejar, nas fontes de um dos seus projetos. Nunca utiliza a atividade das outras pessoas.",
          ],
          links: [
            { href: "/search", label: "Pesquisar no catálogo" },
            { href: "/recommendations", label: "Recomendações" },
          ],
        },
        {
          heading: "O que diz uma ficha",
          paragraphs: [
            "O EduScholar descreve documentos; não os aloja. A ligação oficial leva ao sítio da fonte do documento.",
            "«Origem da ficha» indica de onde vêm as suas informações: uma fonte reconhecida consultada pela plataforma, ou uma proposta de um utilizador. A ficha indica também a data da última verificação e os campos que a moderação corrigiu desde a importação.",
            "A licença diz o que pode fazer com o documento. Verifique-a sempre antes de o reutilizar, copiar ou divulgar.",
            "O estado de acesso diz como o documento se consulta: acesso aberto, ligação gratuita, apenas pré-visualização, acesso através de uma instituição, pago, ou desconhecido quando a fonte não o indica.",
          ],
        },
        {
          heading: "Propor um recurso",
          paragraphs: [
            "Pode propor um documento ao catálogo com a sua ligação oficial e a sua licença. A moderação aprecia-o antes de qualquer publicação; acompanha o seu estado em «As minhas contribuições».",
          ],
          links: [
            { href: "/contribute", label: "Propor um recurso" },
            { href: "/contributions", label: "As minhas contribuições" },
          ],
        },
      ],
    },
    library: {
      title: "A sua biblioteca",
      summary: "Favoritos e coleções: guardar e arrumar as fichas de que precisa.",
      sections: [
        {
          heading: "Favoritos e coleções",
          paragraphs: [
            "Na página de uma ficha, adicione-a aos favoritos ou arrume-a numa coleção que tenha criado. A sua biblioteca é privada: só o próprio a vê.",
            "Eliminar uma coleção não elimina as fichas: estas continuam no catálogo.",
          ],
          links: [{ href: "/library", label: "A minha biblioteca" }],
        },
      ],
    },
    project: {
      title: "O seu projeto de investigação",
      summary: "Ficha do projeto, plano e redação, fontes e fichas de leitura, bibliografia e exportação.",
      sections: [
        {
          heading: "A ficha do projeto",
          paragraphs: [
            "Um projeto é privado por predefinição. A sua ficha reúne o contexto, a problemática, a pergunta principal, as hipóteses, os objetivos, a metodologia e o prazo.",
          ],
          links: [{ href: "/projects", label: "Os meus projetos de investigação" }],
        },
        {
          heading: "O plano e a redação",
          paragraphs: [
            "O plano ordena capítulos, secções e subsecções pela ordem do documento. Cada secção é redigida em texto simples, com trinta mil caracteres no máximo; o texto é guardado automaticamente enquanto escreve.",
            "Em cada secção, indique as fontes que cita, com as respetivas páginas.",
          ],
        },
        {
          heading: "As fontes e as fichas de leitura",
          paragraphs: [
            "Uma fonte é introduzida por si, ou retomada de uma ficha do catálogo. A plataforma nunca inventa nenhuma.",
            "Para cada fonte, uma ficha de leitura guarda a sua análise: problema, conceitos, método, resultados, limites, citação útil. A matriz de literatura compara-as lado a lado. As suas fichas de leitura só são lidas por si.",
          ],
        },
        {
          heading: "A bibliografia, o documento e a exportação",
          paragraphs: [
            "A bibliografia segue a norma APA (7.ª edição, forma de base), a partir das fontes tal como as introduziu. Nada é adivinhado: uma data em falta dá a menção «s. d.» e um aviso.",
            "O documento reúne o título, o índice, as secções redigidas e a bibliografia, em francês ou em inglês. Imprime-se ou guarda-se em PDF a partir do navegador, e transfere-se em Word (.docx) ou em Markdown (.md).",
            "As verificações de coerência assinalam questões de forma a verificar: secção sem citação, fonte nunca citada, fonte incompleta, prazo próximo. Não avaliam o conteúdo do trabalho.",
          ],
        },
      ],
    },
    sharing: {
      title: "Partilhar com um orientador",
      summary: "Convidar uma pessoa, escolher o que lê, receber os seus comentários e decisões.",
      sections: [
        {
          heading: "Convidar",
          paragraphs: [
            "Na página «Gerir a partilha» do seu projeto, introduza o endereço da pessoa. Esta recebe uma mensagem de correio eletrónico com uma ligação válida durante sete dias e tem de iniciar sessão com esse mesmo endereço, confirmado, para aceitar: a ligação, por si só, não dá acesso a nada.",
            "Existem duas funções: «Orientação» e «Apenas leitura». Ninguém pode alterar o seu texto. A orientação comenta as secções, decide sobre as versões que lhe submete e propõe tarefas.",
            "Pode limitar o acesso a algumas secções. As suas fichas de leitura nunca são partilhadas.",
          ],
          links: [
            { href: "/projects", label: "Os meus projetos de investigação" },
            { href: "/shared", label: "Projetos partilhados comigo" },
          ],
        },
        {
          heading: "A ligação de partilha",
          paragraphs: [
            "Uma ligação de partilha não dá nenhum direito e nada diz sobre o projeto: quem a abre pode apenas pedir para o acompanhar, e nada lhe é aberto enquanto não aceitar. É válida durante sete dias.",
          ],
        },
        {
          heading: "Versões e remoção",
          paragraphs: [
            "Uma versão submetida é uma fotografia do seu documento: depois disso, já não muda. A orientação lê-a e decide, e encontra essa decisão no histórico.",
            "Pode remover uma pessoa quando quiser, com efeito imediato; ela também pode sair do projeto por iniciativa própria.",
          ],
          links: [{ href: "/notifications", label: "Notificações" }],
        },
      ],
    },
    offline: {
      title: "A ligação fraca e o modo sem ligação",
      summary: "O que funciona quando falta a rede, e o que não funciona.",
      sections: [
        {
          heading: "O que funciona",
          paragraphs: [
            "O EduScholar pode ser instalado como uma aplicação a partir do navegador. Os ficheiros da interface ficam guardados no dispositivo para carregarem mais depressa.",
            "Se faltar a rede, uma faixa avisa-o, e é apresentada uma página sem ligação em vez de uma página que não pode ser carregada.",
            "Durante a redação de uma secção, se a gravação falhar por falta de rede, o seu texto fica na página e é feita automaticamente uma nova tentativa. Não feche a página antes de a gravação estar confirmada.",
          ],
        },
        {
          heading: "O que não funciona",
          paragraphs: [
            "Nenhum dado privado é guardado no dispositivo: nem o seu projeto, nem a sua biblioteca, nem a sua conta. Sem rede, essas páginas não abrem, e nada do que escrever pode ser guardado.",
            "Num dispositivo partilhado, termine a sessão no fim: assim, nada de privado fica no dispositivo.",
          ],
        },
      ],
    },
    data: {
      title: "Os seus dados pessoais",
      summary: "Transferir uma cópia dos seus dados e eliminar a sua conta.",
      sections: [
        {
          heading: "Transferir uma cópia",
          paragraphs: [
            "Na sua conta, transfira uma cópia dos seus dados num ficheiro JSON, legível por um programa. A palavra-passe é-lhe novamente pedida, e cada transferência fica registada no diário de segurança da sua conta.",
            "A cópia contém, nomeadamente, o seu perfil, a sua biblioteca, os seus projetos com as respetivas fontes, fichas de leitura, secções, tarefas e versões submetidas, os seus comentários, as suas propostas ao catálogo, as suas denúncias, as suas organizações e os eventos de segurança da sua conta. Ela própria indica o que não contém, como as notificações ou os documentos das versões submetidas.",
          ],
          links: [{ href: "/account/export", label: "Transferir os meus dados" }],
        },
        {
          heading: "Eliminar a sua conta",
          paragraphs: [
            "A eliminação é definitiva e confirma-se com a sua palavra-passe. O seu perfil e os seus dados privados são apagados; não é possível qualquer restauro. O diário de segurança conserva registos que já não permitem identificá-lo diretamente.",
          ],
          links: [{ href: "/account/delete", label: "Eliminar a minha conta" }],
        },
      ],
    },
    report: {
      title: "Denunciar um conteúdo",
      summary: "Denunciar uma ficha do catálogo: ligação quebrada, erro, violação de um direito.",
      sections: [
        {
          heading: "Como denunciar",
          paragraphs: [
            "Na página de uma ficha publicada, utilize «Denunciar este recurso» e escolha um motivo: violação de direitos de autor ou de uma licença, dados pessoais, erro na ficha, ligação quebrada, conteúdo impróprio, ficheiro ou ligação maliciosos, ou outro motivo.",
            "A moderação analisa cada denúncia. A sua identidade não é comunicada. O número de denúncias por dia é limitado, para evitar abusos.",
          ],
          links: [{ href: "/search", label: "Pesquisar no catálogo" }],
        },
      ],
    },
  },
};
