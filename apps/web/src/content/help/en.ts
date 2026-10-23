import type { HelpContent } from "./types";

// Help in English. Every sentence describes what the application does today:
// no promise it does not keep.

export const en: HelpContent = {
  index: {
    title: "Help",
    intro:
      "How to use EduScholar: your account, the catalogue, your library, your research project, sharing with a supervisor, weak connections and your data.",
    topicsHeading: "Topics",
    note: "These pages describe the platform as it works today. It is still under construction: some features will change.",
  },
  backToIndex: "Back to help",
  relatedHeading: "Going further",
  topics: {
    account: {
      title: "Creating your account and securing your sign-in",
      summary: "Signing up, confirming your address, your profile, a forgotten password and two-step verification.",
      sections: [
        {
          heading: "Creating an account",
          paragraphs: [
            "Choose an email address and a password of at least twelve characters, with letters and digits. A password that is too common, or that appears in known data breaches, is refused. You may be asked to complete an anti-robot check.",
            "A message is sent to the address you gave. Open the link it contains to activate your account, then sign in.",
            "When you first sign in, you complete a minimal profile: country, level of study and programme, and a statement that you are old enough in your country. This information adapts the search; only you can see it.",
          ],
          links: [
            { href: "/sign-up", label: "Create an account" },
            { href: "/sign-in", label: "Sign in" },
          ],
        },
        {
          heading: "Forgotten password",
          paragraphs: [
            "From the sign-in page, ask for a link to choose a new password. The message only arrives if an account exists for that address. Once the password is changed, all your devices are signed out.",
          ],
          links: [{ href: "/forgot-password", label: "Forgotten password" }],
        },
        {
          heading: "Two-step verification",
          paragraphs: [
            "In addition to your password, it asks for a six-digit code shown by an authenticator app installed on your phone. Turn it on from “Account security”: scan the code shown, or type the key by hand, then enter the first code.",
            "Generate your ten recovery codes straight away, and keep them somewhere other than that phone. Each one works only once. If you lose the app, a recovery code gives you access again; two-step verification is then turned off and your other sessions are closed: turn it back on with your new device.",
            "Moderation and administration roles require two-step verification.",
          ],
          links: [{ href: "/account/security", label: "Account security" }],
        },
      ],
    },
    search: {
      title: "Searching the catalogue and understanding a record",
      summary: "Search, its filters, and what a record's origin, licence and access status tell you.",
      sections: [
        {
          heading: "Searching",
          paragraphs: [
            "Search is open to accounts whose profile is complete. Type some words, then narrow down by document type, language, access status, level or a subject of your programme.",
            "Only records published by moderation appear: a proposal under review is shown to no one.",
            "The “Recommendations” page suggests records based on your profile alone and, if you choose, on the sources of one of your projects. It never uses other people's activity.",
          ],
          links: [
            { href: "/search", label: "Search the catalogue" },
            { href: "/recommendations", label: "Recommendations" },
          ],
        },
        {
          heading: "What a record tells you",
          paragraphs: [
            "EduScholar describes documents; it does not host them. The official link leads to the website of the document's source.",
            "“Origin of the record” says where its information comes from: a recognised source queried by the platform, or a user's proposal. The record also gives the date it was last checked, and the fields that moderation has corrected since the import.",
            "The licence says what you may do with the document. Always check it before reusing, copying or sharing the document.",
            "The access status says how the document can be read: open access, free link, preview only, access through an institution, paid, or unknown when the source does not say.",
          ],
        },
        {
          heading: "Proposing a resource",
          paragraphs: [
            "You can propose a document to the catalogue with its official link and its licence. Moderation reviews it before any publication; you follow its status in “My contributions”.",
          ],
          links: [
            { href: "/contribute", label: "Propose a resource" },
            { href: "/contributions", label: "My contributions" },
          ],
        },
      ],
    },
    library: {
      title: "Your library",
      summary: "Favourites and collections: keeping and sorting the records you use.",
      sections: [
        {
          heading: "Favourites and collections",
          paragraphs: [
            "From a record's page, add it to your favourites or file it in a collection you have created. Your library is private: only you can see it.",
            "Deleting a collection does not delete the records: they stay in the catalogue.",
          ],
          links: [{ href: "/library", label: "My library" }],
        },
      ],
    },
    project: {
      title: "Your research project",
      summary: "Project record, outline and writing, sources and reading notes, bibliography and export.",
      sections: [
        {
          heading: "The project record",
          paragraphs: [
            "A project is private by default. Its record gathers the context, the problem statement, the main question, the hypotheses, the objectives, the methodology and the deadline.",
          ],
          links: [{ href: "/projects", label: "My research projects" }],
        },
        {
          heading: "Outline and writing",
          paragraphs: [
            "The outline orders chapters, sections and subsections as they appear in the document. Each section is written in plain text, thirty thousand characters at most; the text saves itself while you write.",
            "In each section, indicate the sources it cites, with their pages.",
          ],
        },
        {
          heading: "Sources and reading notes",
          paragraphs: [
            "A source is entered by you, or taken from a catalogue record. The platform never invents one.",
            "For each source, a reading note keeps your analysis: problem, concepts, method, results, limits, useful quotation. The literature matrix compares them side by side. Your reading notes are read by you alone.",
          ],
        },
        {
          heading: "Bibliography, document and export",
          paragraphs: [
            "The bibliography follows the APA style (7th edition, basic form), from the sources as you entered them. Nothing is guessed: a missing date gives the mention “n.d.” and a warning.",
            "The document brings together the title, the table of contents, the written sections and the bibliography, in French or in English. It prints or saves as PDF from the browser, and downloads as Word (.docx) or Markdown (.md).",
            "Consistency checks point out matters of form to check: a section without a citation, a source never cited, an incomplete source, an approaching deadline. They do not assess the substance of the work.",
          ],
        },
      ],
    },
    sharing: {
      title: "Sharing with a supervisor",
      summary: "Inviting someone, choosing what they read, receiving their comments and decisions.",
      sections: [
        {
          heading: "Inviting",
          paragraphs: [
            "From your project's “Manage sharing” page, enter the person's address. They receive an email with a link valid for seven days, and must sign in with that same, confirmed address to accept: the link alone gives no access.",
            "There are two roles: “Supervision” and “Read only”. No one can change your text. Supervision comments on sections, gives a decision on the versions you submit, and proposes tasks.",
            "You can restrict access to some sections. Your reading notes are never shared.",
          ],
          links: [
            { href: "/projects", label: "My research projects" },
            { href: "/shared", label: "Projects shared with me" },
          ],
        },
        {
          heading: "The sharing link",
          paragraphs: [
            "A sharing link grants no right and says nothing about the project: the person who opens it can only ask to follow it, and nothing is opened to them until you accept. It is valid for seven days.",
          ],
        },
        {
          heading: "Versions and removal",
          paragraphs: [
            "A submitted version is a snapshot of your document: it never changes afterwards. Supervision reads it and gives a decision, which you find in the history.",
            "You can remove a person whenever you like, with immediate effect; they can also leave the project themselves.",
          ],
          links: [{ href: "/notifications", label: "Notifications" }],
        },
      ],
    },
    offline: {
      title: "Weak connections and offline mode",
      summary: "What works when the network is missing, and what does not.",
      sections: [
        {
          heading: "What works",
          paragraphs: [
            "EduScholar can be installed as an app from the browser. The interface files are kept on the device so that they load faster.",
            "If the network is missing, a banner says so, and an offline page is shown instead of a page that cannot be loaded.",
            "While you write a section, if saving fails for lack of network, your text stays in the page and a new attempt happens automatically. Do not close the page before the save is confirmed.",
          ],
        },
        {
          heading: "What does not work",
          paragraphs: [
            "No private data is kept on the device: not your project, not your library, not your account. Without a network, these pages do not open, and nothing you type can be saved.",
            "On a shared device, sign out at the end: nothing private then stays on the device.",
          ],
        },
      ],
    },
    data: {
      title: "Your personal data",
      summary: "Downloading a copy of your data, and deleting your account.",
      sections: [
        {
          heading: "Downloading a copy",
          paragraphs: [
            "From your account, download a copy of your data as a JSON file that a program can read. Your password is asked for again, and each download is recorded in your account's security log.",
            "The copy contains, among other things, your profile, your library, your projects with their sources, reading notes, sections, tasks and submitted versions, your comments, your catalogue proposals, your reports, your organisations and your account's security events. It says itself what it does not contain, such as notifications or the documents of submitted versions.",
          ],
          links: [{ href: "/account/export", label: "Download my data" }],
        },
        {
          heading: "Deleting your account",
          paragraphs: [
            "Deletion is permanent and is confirmed with your password. Your profile and your private data are erased; no restoration is possible. The security log keeps traces that no longer identify you directly.",
          ],
          links: [{ href: "/account/delete", label: "Delete my account" }],
        },
      ],
    },
    report: {
      title: "Reporting content",
      summary: "Reporting a catalogue record: a broken link, an error, an infringed right.",
      sections: [
        {
          heading: "How to report",
          paragraphs: [
            "On the page of a published record, use “Report this resource” and choose a reason: copyright or licence infringement, personal data, an error in the record, a broken link, inappropriate content, a malicious file or link, or another reason.",
            "Moderation reviews every report. Your identity is not disclosed. The number of reports per day is limited, to prevent abuse.",
          ],
          links: [{ href: "/search", label: "Search the catalogue" }],
        },
      ],
    },
  },
};
