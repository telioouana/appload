// Locale-independent site data: rosters, external links, phone numbers.
// Translated copy lives in src/messages/*; this file holds what never
// translates (names, URLs, file paths).

export const SOCIALS = {
    linkedin: "https://www.linkedin.com/company/apploadafrica/",
    facebook: "https://www.facebook.com/profile.php?id=100064477002754",
    instagram: "https://www.instagram.com/appload.co.mz/",
    youtube: "https://www.youtube.com/@appload7874",
} as const;

export const CONTACT = {
    email: "info@apploadafrica.com",
    address: "Avenida Paulo Samuel Kankhomba, 1063, Bairro Central, Maputo",
    addressUrl: "https://maps.app.goo.gl/DGARVh9LfF9AsyKE8",
    lines: {
        support: "+258 87 780 5615",
        administration: "+258 87 606 4266",
        sales: "+258 87 990 5615",
    },
} as const;

export type Partner = {
    name: string;
    src: string;
};

export const PARTNERS: Partner[] = [
    { name: "GIZ", src: "/partners/giz.png" },
    { name: "USAID", src: "/partners/usaid.svg" },
    { name: "World Bank", src: "/partners/world-bank.png" },
    { name: "Standard Bank", src: "/partners/standard-bank.png" },
    { name: "ABSA", src: "/partners/absa.png" },
    { name: "Hollard", src: "/partners/hollard.png" },
    { name: "UKaid", src: "/partners/dfid.svg" },
    { name: "Astra", src: "/partners/astra.svg" },
    { name: "TotalEnergies", src: "/partners/total.svg" },
];

export type TeamMember = {
    /** Key into the `team` message namespace for the role label */
    key: "claire" | "catherine" | "fred" | "elonia" | "khiven" | "raufa" | "telio";
    name: string;
    image: string;
    linkedin?: string;
};

export const TEAM: TeamMember[] = [
    { key: "claire", name: "Claire Hassoun", image: "/team/claire.png", linkedin: "https://www.linkedin.com/in/claire-hassoun-45b003a2/" },
    { key: "catherine", name: "Catherine Hinds", image: "/team/catherine.png" },
    { key: "fred", name: "Frederico Silva", image: "/team/fred.png", linkedin: "https://www.linkedin.com/in/frederico-p-silva-4b149737/" },
    { key: "elonia", name: "Elónia Mahumane", image: "/team/elonia.png", linkedin: "https://www.linkedin.com/in/elónia-rabeca-4b5a15279/" },
    { key: "khiven", name: "Khiven João", image: "/team/khiven.png", linkedin: "https://www.linkedin.com/in/khiven-joão-633a3817a/" },
    { key: "raufa", name: "Raufa Mussá", image: "/team/raufa.png", linkedin: "https://www.linkedin.com/in/raufa-nadimo-mussá-a7493b2ab/" },
    { key: "telio", name: "Télio Ouana", image: "/team/telio.png", linkedin: "https://www.linkedin.com/in/télio-ouana" },
];

export type Review = {
    name: string;
    role: string;
    /** Kept in the language it was written in — these are real quotes */
    text: string;
};

export const REVIEWS: Review[] = [
    {
        name: "Saurab Shetty",
        role: "Sales and Operations Officer — ETC Adubos (ETG)",
        text: "Appload really impresses me with their commitment to delivering cargo on time. Every time I've interacted with them, they've shown they're reliable and determined to meet deadlines without compromising the safety of the cargo. My interactions with Appload have been stress-free and seamless.",
    },
    {
        name: "Ruben Morgado",
        role: "Fundação Carlos Morgado (Girrafa Solar)",
        text: "Acerca dos vossos serviços, infelizmente, só tenho comentários para fazer: dedicação, tratamento personalizado e comunicação em tempo real sobre a minha mercadoria é fundamental para criar confiança ao transportar uma carga tão valiosa por 2500km.",
    },
    {
        name: "Nico Milissao",
        role: "Gestor Assistente de Clientes — Nacala-Frios",
        text: "A Appload tem feito um ótimo trabalho no que diz respeito na oferta dos serviços assim como a relação interpessoal e isso facilita a coordenação ou marcação de um novo trabalho.",
    },
];
