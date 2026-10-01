/**
 * Rejects passwords that satisfy the character-class rules but are still trivially guessable
 * ("Password123!", "Qwerty@2024", "Welcome1!"). Compared after lower-casing, undoing common
 * letter substitutions (@ → a, 0 → o …) and dropping everything that is not a letter.
 */
const COMMON = new Set([
  "password",
  "passwd",
  "passw",
  "pass",
  "letmein",
  "welcome",
  "welcomeback",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "abc",
  "abcd",
  "abcde",
  "abcdef",
  "admin",
  "administrator",
  "root",
  "user",
  "login",
  "master",
  "changeme",
  "changemenow",
  "iloveyou",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "basketball",
  "soccer",
  "superman",
  "batman",
  "princess",
  "sunshine",
  "shadow",
  "secret",
  "trustno",
  "freedom",
  "whatever",
  "starwars",
  "hello",
  "hunter",
  "michael",
  "jennifer",
  "bank",
  "banking",
  "feedback",
  "customer",
  "ethiopia",
  "addisababa",
  "test",
  "testing",
  "temp",
  "temporary",
  "default",
  "guest",
  "demo",
  "summer",
  "winter",
  "spring",
  "autumn",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

function normalize(p: string): string {
  return [...p.toLowerCase()]
    .map((c) => LEET[c] ?? c)
    .join("")
    .replace(/[^a-z]/g, "");
}

/** Variants to test: as typed, and with the usual trailing "123!" / "2024" decoration removed first. */
function candidates(p: string): string[] {
  const lower = p.toLowerCase();
  return [normalize(lower), normalize(lower.replace(/[^a-z]+$/, ""))];
}

export function isWeakPassword(password: string): boolean {
  if (new Set(password).size < 5) return true; // "aaaaaaA1!a"
  return candidates(password).some((n) => {
    if (COMMON.has(n)) return true;
    // doubled words such as "passwordpassword"
    const half = n.length / 2;
    return (
      Number.isInteger(half) && half > 0 && COMMON.has(n.slice(0, half)) && n.slice(0, half) === n.slice(half)
    );
  });
}
