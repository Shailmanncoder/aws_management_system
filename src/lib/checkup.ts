/**
 * The account check-up: what is missing or wrong in the connected cloud account, written for
 * someone who does not work in IT.
 *
 * Rules for every string in this file:
 *  - short sentences, everyday words;
 *  - no acronym or technical term without a plain explanation right next to it;
 *  - say the consequence in real terms ("anyone on the internet can read them"), not in jargon
 *    ("public ACL grant");
 *  - never frighten someone into a change without saying what it will break.
 *
 * `tests/unit/checkup.test.ts` enforces the readability rules mechanically, so this stays honest
 * as checks are added.
 */

/** How soon it is worth doing. Deliberately words, not severity codes. */
export type CheckUrgency = "now" | "soon" | "whenever" | "done";

export const URGENCY_LABELS: Record<CheckUrgency, string> = {
  now: "Do this now",
  soon: "Do this soon",
  whenever: "Worth doing",
  done: "All good",
};

export const URGENCY_ORDER: CheckUrgency[] = ["now", "soon", "whenever", "done"];

/** How the problem gets fixed. */
export type FixKind =
  /** Stratus can do it itself, right here. */
  | "stratus-can-do-it"
  /** Step-by-step instructions for the AWS website. */
  | "guide"
  /** Somewhere else in Stratus. */
  | "in-app"
  /** Nothing to do; it is already fine. */
  | "nothing";

export interface CheckCopy {
  id: string;
  /** What is wrong, in one plain sentence. */
  title: string;
  /** What that actually means. Assume the reader has never used AWS. */
  meaning: string;
  /** What could happen if it is left alone. */
  whyItMatters: string;
  /** The next step, in plain words. */
  whatToDo: string;
  /** Walkthrough that fixes it, if there is one. */
  guideId?: string;
  /** Somewhere in Stratus to go instead. */
  href?: string;
  linkLabel?: string;
  fixKind: FixKind;
  /** Shown when there is nothing wrong. */
  goodNews: string;
}

/**
 * Every check Stratus can make. The service decides which apply; this file only holds the words,
 * so the wording can be reviewed without reading any database code.
 */
export const CHECKS: Record<string, CheckCopy> = {
  connectAccount: {
    id: "connectAccount",
    title: "No cloud account is connected yet",
    meaning:
      "Stratus has not been given permission to look at your Amazon account, so it has nothing to show you. Amazon Web Services, usually shortened to AWS, is the company that runs the servers your software sits on.",
    whyItMatters: "Until you connect one, every page here will be empty.",
    whatToDo: "Connect an account. It takes about five minutes and Stratus only asks for permission to read, never to change or delete.",
    href: "/settings/cloud-accounts",
    linkLabel: "Connect an account",
    fixKind: "in-app",
    goodNews: "Your cloud account is connected.",
  },

  firstSync: {
    id: "firstSync",
    title: "Stratus has not looked at your account yet",
    meaning: "The account is connected, but nobody has pressed refresh, so we do not know what is in it.",
    whyItMatters: "Nothing on these pages will be accurate until the first check runs.",
    whatToDo: "Press the Refresh button. The first one takes a few minutes because it looks in every region.",
    href: "/resources",
    linkLabel: "Go and refresh",
    fixKind: "in-app",
    goodNews: "We have looked at your account and know what is in it.",
  },

  syncFailing: {
    id: "syncFailing",
    title: "Stratus cannot read your account at the moment",
    meaning: "The last attempt to look at your account failed. Usually the permission it was given was changed or removed.",
    whyItMatters: "Everything you see here is now old. A problem could appear in your account and nobody would be told.",
    whatToDo: "Open the account settings. Stratus says exactly which permission is missing and how to put it back.",
    href: "/settings/cloud-accounts",
    linkLabel: "See what went wrong",
    fixKind: "in-app",
    goodNews: "Stratus can read your account normally.",
  },

  billingOff: {
    id: "billingOff",
    title: "You cannot see what you are spending",
    meaning:
      "Amazon keeps spending information switched off until someone turns it on. It is a setting called Cost Explorer, and only the main account owner can enable it.",
    whyItMatters: "Without it you cannot tell what your bill will be, or spot something expensive you forgot to turn off.",
    whatToDo: "Sign in to Amazon as the main account owner and switch on Cost Explorer. Numbers start appearing within about a day.",
    href: "/cost",
    linkLabel: "See the spending page",
    fixKind: "in-app",
    goodNews: "You can see your spending.",
  },

  publicStorage: {
    id: "publicStorage",
    title: "Some of your files can be opened by anyone",
    meaning:
      "You have storage folders, called buckets, that are set so anybody on the internet can read what is inside. They do not need a password and you would not know they had.",
    whyItMatters:
      "If anything private is in there, such as customer details, backups or documents, it is already readable by strangers and by search engines.",
    whatToDo: "Make them private. Check first whether a website is using the files, because closing it will stop that website working.",
    guideId: "fix-s3-public-access",
    fixKind: "guide",
    goodNews: "None of your files are open to the public.",
  },

  openPorts: {
    id: "openPorts",
    title: "Your machines are open to the whole internet",
    meaning:
      "A machine is reachable from any computer in the world, on a door normally used for remote control or for databases. Think of it as leaving the front door unlocked rather than only letting your own office in.",
    whyItMatters:
      "Computers around the world automatically hunt for these doors, day and night. It is usually found within minutes, not months.",
    whatToDo: "Narrow it down so only your office, your own equipment, or your own application can reach it.",
    guideId: "fix-security-group-open",
    fixKind: "guide",
    goodNews: "Nothing is left open to the whole internet.",
  },

  noEncryption: {
    id: "noEncryption",
    title: "Some of your data is not scrambled",
    meaning:
      "Scrambling, usually called encryption, means the data is stored in a form nobody can read without the key. Some of your disks or databases are stored plainly instead.",
    whyItMatters: "If a copy of that disk is ever shared or taken, whoever has it can read everything on it.",
    whatToDo: "Encryption cannot be switched on where it already exists, so this means making a scrambled copy and swapping it in. Plan a quiet time for it.",
    guideId: "fix-ebs-unencrypted",
    fixKind: "guide",
    goodNews: "Your disks and databases are scrambled.",
  },

  noBackups: {
    id: "noBackups",
    title: "A database has no backups",
    meaning: "Nothing is being saved, so there is no copy to go back to. If the data is deleted or damaged, it is gone.",
    whyItMatters: "One wrong command, or one faulty piece of software, and the information cannot be recovered at all.",
    whatToDo: "Switch backups on and keep at least a week. Amazon does not charge extra for backups up to the size of the database.",
    guideId: "fix-rds-backups",
    fixKind: "guide",
    goodNews: "Your databases are being backed up.",
  },

  wastingMoney: {
    id: "wastingMoney",
    title: "You are paying for things you are not using",
    meaning: "Stratus found things that are switched on and charging you, but appear to be doing nothing.",
    whyItMatters: "This is money leaving every month for no benefit. It is the easiest saving to make.",
    whatToDo: "Look at the list. Each one says how confident Stratus is, so check before switching anything off.",
    href: "/optimization",
    linkLabel: "See what is wasting money",
    fixKind: "in-app",
    goodNews: "Nothing obvious is being wasted.",
  },

  noAlerts: {
    id: "noAlerts",
    title: "Nobody gets told when something goes wrong",
    meaning: "No alerts are set up, so a new problem only gets noticed if someone happens to open Stratus and look.",
    whyItMatters: "Something could be left open to the internet, or your bill could jump, and days could pass before anyone notices.",
    whatToDo: "Turn on the recommended alerts. Stratus can do this for you right now, and you can change them afterwards.",
    href: "/settings/alerts",
    linkLabel: "See alert settings",
    fixKind: "stratus-can-do-it",
    goodNews: "Alerts are set up, so you will be told when something changes.",
  },

  noTwoFactor: {
    id: "noTwoFactor",
    title: "Your Stratus login only has a password",
    meaning:
      "Two-factor means a second check when you sign in, usually a six-digit code from an app on your phone. Yours is switched off.",
    whyItMatters: "If your password is guessed or leaks from somewhere else, anyone can sign in and see everything in your cloud account.",
    whatToDo: "Switch it on in your profile. It takes about a minute and you only need your phone.",
    href: "/settings/profile",
    linkLabel: "Turn on two-factor",
    fixKind: "in-app",
    goodNews: "Your login is protected by a second check.",
  },

  untagged: {
    id: "untagged",
    title: "You cannot tell whose costs are whose",
    meaning:
      "Labels, called tags, are short notes stuck on each thing, such as which team owns it. Many of yours have none, so the bill cannot be split up.",
    whyItMatters: "When the bill grows, nobody can say which team or project caused it, so nobody takes responsibility for it.",
    whatToDo: "Decide on a couple of labels everyone uses, such as team and environment, and add them as things are created.",
    href: "/optimization",
    linkLabel: "See what is unlabelled",
    fixKind: "in-app",
    goodNews: "Your things are labelled, so costs can be split up.",
  },
};

export type CheckId = keyof typeof CHECKS;
