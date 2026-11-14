/** Observed sign-in text used only to prove a refusal record copies none of it. */

const EMPLOYEE_ID = "10456712";
const ENCODED_EMPLOYEE_ID = "%31%30%34%35%36%37%31%32";
const LISTED_SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const PEOPLESOFT = "https://ucphrprdpub.universityofcalifornia.edu";
const PEOPLESOFT_PREFIX = "/psc/ucphrprd/EMPLOYEE/HRMS/";

export type SignInRefusalProbe = {
  readonly name: string;
  readonly detail: string;
  readonly observedUrl: string;
  readonly canaries: readonly string[];
};

function encodeAll(text: string): string {
  return [...text].map(character => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
}

function probe(name: string, detail: string, observedUrl: string, canaries: readonly string[]): SignInRefusalProbe {
  return { name, detail, observedUrl, canaries };
}

const BOUNDARY_ESCAPES = ["%20", "%09", "%0A", "%0D", "%22", "%27", "%3C", "%3E", "%E2%80%A8"] as const;

function boundaryProbes(): SignInRefusalProbe[] {
  const rows: SignInRefusalProbe[] = [];
  for (const escape of BOUNDARY_ESCAPES) {
    const literal = `https://example.test/read${escape}tail?subject=QUERY_CANARY#FRAGMENT_CANARY`;
    const encoded = encodeAll(literal);
    const canaries = ["QUERY_CANARY", "FRAGMENT_CANARY", literal, encoded];
    rows.push(probe(`boundary ${escape} in the reason`, literal, LISTED_SSO, canaries));
    rows.push(probe(`boundary ${escape} as the page`, "the check refused", literal, canaries));
    rows.push(probe(`encoded boundary ${escape} in the reason`, encoded, LISTED_SSO, canaries));
    rows.push(probe(`encoded boundary ${escape} as the page`, "the check refused", encoded, canaries));
  }
  return rows;
}

const PRIVATE_TEXT = "password=SECRET_CANARY HTTPS://user:USERINFO_CANARY@example.test/read?token=QUERY_CANARY#FRAGMENT_CANARY";
const PRIVATE_CANARIES = ["SECRET_CANARY", "USERINFO_CANARY", "QUERY_CANARY", "FRAGMENT_CANARY"];

export const SIGN_IN_REFUSAL_PROBES: readonly SignInRefusalProbe[] = [
  probe("plain employee id in the reason", `the check refused employee ${EMPLOYEE_ID}`, LISTED_SSO, [EMPLOYEE_ID]),
  probe("plain employee id in the path", "the check refused", `https://example.test/people/${EMPLOYEE_ID}`, [EMPLOYEE_ID]),
  probe("percent-encoded employee id in the reason", `the check saw https://example.test/people/${ENCODED_EMPLOYEE_ID}`, LISTED_SSO, [EMPLOYEE_ID, ENCODED_EMPLOYEE_ID]),
  probe("percent-encoded employee id in the path", "the check refused", `https://example.test/people/${ENCODED_EMPLOYEE_ID}`, [EMPLOYEE_ID, ENCODED_EMPLOYEE_ID]),
  probe("uppercase credential url in the reason", `the check saw ${PRIVATE_TEXT}`, LISTED_SSO, PRIVATE_CANARIES),
  probe("uppercase credential url as the page", "the check refused", PRIVATE_TEXT, PRIVATE_CANARIES),
  probe("fully percent-encoded private text in the reason", `the check saw ${encodeAll(PRIVATE_TEXT)}`, LISTED_SSO, [...PRIVATE_CANARIES, encodeAll(PRIVATE_TEXT)]),
  probe("fully percent-encoded private text as the page", "the check refused", encodeAll(PRIVATE_TEXT), [...PRIVATE_CANARIES, encodeAll(PRIVATE_TEXT)]),
  probe("long page", "the check refused", `https://example.test/${"p".repeat(100_000)}LONG_PAGE_CANARY`, ["LONG_PAGE_CANARY"]),
  probe("long reason", `${"r".repeat(200_000)}LONG_REASON_CANARY`, LISTED_SSO, ["LONG_REASON_CANARY"]),
  probe("multibyte reason", `the check refused ${"€".repeat(50_000)}MULTIBYTE_CANARY`, LISTED_SSO, ["MULTIBYTE_CANARY", "€"]),
  probe("query hidden in the path", "the check refused", "https://example.test/read%3Ftoken%3DQUERY_CANARY%23FRAGMENT_CANARY", ["QUERY_CANARY", "FRAGMENT_CANARY", "%3Ftoken%3DQUERY_CANARY"]),
  probe("undecodable employee id", `the check saw https://example.test/people/%FF${ENCODED_EMPLOYEE_ID}`, `https://example.test/people/%FF${ENCODED_EMPLOYEE_ID}`, [EMPLOYEE_ID, ENCODED_EMPLOYEE_ID, `%FF${ENCODED_EMPLOYEE_ID}`]),
  probe("session id under a listed prefix", "the check refused", `${PEOPLESOFT}${PEOPLESOFT_PREFIX}c/app;jsessionid=SESSION_CANARY?EMPLID=${EMPLOYEE_ID}`, ["SESSION_CANARY", EMPLOYEE_ID]),
  probe("employee id under a listed prefix", "the check refused", `${PEOPLESOFT}${PEOPLESOFT_PREFIX}c/${EMPLOYEE_ID}`, [EMPLOYEE_ID]),
  probe("dot segments leaving a listed path", "the check refused", `${PEOPLESOFT}${PEOPLESOFT_PREFIX}../SECRET_SEGMENT`, ["SECRET_SEGMENT"]),
  probe("employee id in a host label", "the check refused", `https://${EMPLOYEE_ID}.example.test/read`, [EMPLOYEE_ID]),
  probe("employee id in a duo subdomain", "the check refused", `https://${EMPLOYEE_ID}.duosecurity.com/frame?token=QUERY_CANARY`, [EMPLOYEE_ID, "QUERY_CANARY"]),
  probe("lookalike host", "the check refused", "https://a5.ucsd.edu.evil.test/tritON/profile/SAML2/Redirect/SSO?token=QUERY_CANARY", ["QUERY_CANARY", "evil.test"]),
  probe("another port", "the check refused", "https://a5.ucsd.edu:8443/tritON/profile/SAML2/Redirect/SSO?token=QUERY_CANARY", ["8443", "QUERY_CANARY"]),
  probe("http", "the check refused", `http://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO?token=QUERY_CANARY`, ["http://a5.ucsd.edu", "QUERY_CANARY"]),
  probe("data url", "the check refused", `data:text/plain,${EMPLOYEE_ID}`, [EMPLOYEE_ID]),
  probe("backslash before at", "the check refused", "https://user\\@a5.ucsd.edu/path?x=QUERY_CANARY", ["QUERY_CANARY"]),
  probe("empty address", `the check refused employee ${EMPLOYEE_ID}`, "", [EMPLOYEE_ID]),
  probe("text that is not a url", `the check refused employee ${EMPLOYEE_ID}`, "not a url", [EMPLOYEE_ID, "not a url"]),
  probe("about blank", "the check refused", `about:blank?EMPLID=${EMPLOYEE_ID}`, [EMPLOYEE_ID]),
  probe("listed path keeps the query out", "the check refused", `${LISTED_SSO}?EMPLID=${EMPLOYEE_ID}#FRAGMENT_CANARY`, [EMPLOYEE_ID, "FRAGMENT_CANARY"]),
  probe("userinfo on a listed path", "the check refused", `https://user:USERINFO_CANARY@a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO`, ["USERINFO_CANARY"]),
  ...boundaryProbes(),
];
