import { describe, expect, it } from "vitest";
import { createAdapterRegistry } from "../../adapters/registry.js";
import { FixturePageReader, node } from "./fixture-reader.js";

const TARGET_URL = "https://x.com/NASA/status/2040059770237849635";
const TWEET_ROOT = "article[data-testid='tweet']";
const TWEET_TEXT = "article[data-testid='tweet'] [data-testid='tweetText']";
const USER_NAME = "article[data-testid='tweet'] [data-testid='User-Name']";
const STATUS_LINK = "a[href*='/status/']";
const TIME = "article[data-testid='tweet'] time";
const TIME_LINK = "article[data-testid='tweet'] a[href*='/status/']:has(time)";
const VIEWS_LINK = "article[data-testid='tweet'] a[role='link'][href*='/status/'][href$='/analytics']:not([data-testid='tweetText'] *)";
const QUOTES_LINK = "article[data-testid='tweet'] a[role='link'][href*='/status/'][href$='/quotes']:not([data-testid='tweetText'] *)";
const PHOTO_ALT_BUTTON = "article[data-testid='tweet'] [data-testid='tweetPhoto'] button:not(:has(img,video,audio))";

function xAdapter() {
  const adapter = createAdapterRegistry().get("x");
  if (!adapter) throw new Error("Missing X adapter");
  return adapter;
}

describe("X observed single-post shape", () => {
  it("keeps only the target author and source text while omitting controls and sibling replies", () => {
    const sourcePrefix = "Source-authored wording deliberately keeps these control-like words and links when they belong to the post itself. This fixture is longer than two hundred characters so the browser text cannot be silently reduced to a presentation-sized title. Continue reading the original sentence including";
    const sourceMiddle = "alongside";
    const sourceSuffix = "and the ordinary text ALT, all of which are part of the authored body.";
    const sourceText = `${sourcePrefix} View quotes ${sourceMiddle} 77.6M Views ${sourceSuffix}`;
    expect(sourceText.length).toBeGreaterThan(200);
    const author = node("x-live-author", "div", "NASA @NASA", { "data-testid": "User-Name" });
    const authoredQuotesLink = node("x-live-authored-quotes-link", "a", "View quotes", { href: "/NASA/status/2040059770237849635/quotes", role: "link" });
    const authoredViewsLink = node("x-live-authored-views-link", "a", "77.6M Views", { href: "/NASA/status/2040059770237849635/analytics", role: "link" });
    const body = node("x-live-body", "div", sourceText, { "data-testid": "tweetText" }, [
      node("x-live-body-prefix", "#text", sourcePrefix),
      authoredQuotesLink,
      node("x-live-body-middle", "#text", sourceMiddle),
      authoredViewsLink,
      node("x-live-body-suffix", "#text", sourceSuffix),
    ]);
    const time = node("x-live-time", "time", "9:32 PM · Apr 3, 2026", { datetime: "2026-04-03T13:32:06.000Z" });
    const selfLink = node("x-live-self-link", "a", "9:32 PM · Apr 3, 2026", { href: "/NASA/status/2040059770237849635", role: "link" }, [time]);
    const timeParent = node("x-live-time-parent", "div", "9:32 PM · Apr 3, 2026", {}, [selfLink]);
    // The live separator has no stable structural marker. Keep it as a known
    // gap rather than deleting every source-authored middle dot.
    const metadataSeparator = node("x-live-metadata-separator", "div", "·");
    const viewsLink = node("x-live-views-link", "a", "77.6M Views", { href: "/NASA/status/2040059770237849635/analytics", role: "link" });
    const metadataRow = node("x-live-metadata-row", "div", "", {}, [timeParent, metadataSeparator, viewsLink]);
    const targetImage = node("x-live-image", "img", "", { src: "https://pbs.twimg.com/media/target.jpg" });
    const altButton = node("x-live-alt-button", "button", "ALT");
    const targetPhoto = node("x-live-photo", "div", "", { "data-testid": "tweetPhoto" }, [targetImage, altButton]);
    const photoLink = node("x-live-photo-link", "a", "", { href: "/NASA/status/2040059770237849635/photo/1", role: "link" }, [targetPhoto]);
    const quotesLink = node("x-live-quotes-link", "a", "View quotes", { href: "/NASA/status/2040059770237849635/quotes", role: "link" });
    const replyControl = node("x-live-reply-control", "div", "· 18K Replies", { "data-testid": "reply" });
    const retweetControl = node("x-live-retweet-control", "div", "92K reposts", { "data-testid": "retweet" });
    const likeControl = node("x-live-like-control", "div", "1.2M Likes", { "data-testid": "like" });
    const bookmarkControl = node("x-live-bookmark-control", "div", "Bookmark", { "data-testid": "bookmark" });
    const targetWrapper = node("x-live-target-wrapper", "div", "", {}, [
      author,
      body,
      metadataRow,
      photoLink,
      quotesLink,
      replyControl,
      retweetControl,
      likeControl,
      bookmarkControl,
    ]);
    const target = node("x-live-target", "article", `${sourceText} NASA @NASA 9:32 PM · Apr 3, 2026 18K Replies`, { "data-testid": "tweet" }, [targetWrapper]);

    const replyText = node("x-live-sibling-reply-text", "div", "This sibling reply must not be collected", { "data-testid": "tweetText" });
    const replyLink = node("x-live-sibling-reply-link", "a", "reply time", { href: "/someone/status/2040059770237849999", role: "link" });
    const siblingReply = node("x-live-sibling-reply", "article", "This sibling reply must not be collected", { "data-testid": "tweet" }, [replyText, replyLink]);

    // These author links mirror the broad live query that previously promoted
    // every target-root link into snapshot.authors.
    const displayNameLink = node("x-live-display-link", "a", "NASA", { href: "/NASA", role: "link" });
    const handleLink = node("x-live-handle-link", "a", "@NASA", { href: "/NASA", role: "link" });

    const reader = new FixturePageReader(TARGET_URL, sourceText)
      .add(TWEET_ROOT, [target, siblingReply])
      .add(STATUS_LINK, [selfLink, photoLink, viewsLink, quotesLink, authoredQuotesLink, authoredViewsLink], target)
      .add(STATUS_LINK, [replyLink], siblingReply)
      .add(TWEET_TEXT, [body], target)
      .add(USER_NAME, [author], target)
      .add(TIME, [time], target)
      .add(TIME_LINK, [selfLink], target)
      .add("article[data-testid='tweet'] [data-testid='tweetPhoto'] img", [targetImage], target)
      .add(VIEWS_LINK, [viewsLink], target)
      .add(QUOTES_LINK, [quotesLink], target)
      .add(PHOTO_ALT_BUTTON, [altButton], target)
      .add("article[data-testid='tweet'] [data-testid='reply']", [replyControl], target)
      .add("article[data-testid='tweet'] [data-testid='retweet']", [retweetControl], target)
      .add("article[data-testid='tweet'] [data-testid='like']", [likeControl], target)
      .add("article[data-testid='tweet'] [data-testid='bookmark']", [bookmarkControl], target)
      .add("article[data-testid='tweet'] a[role='link'][href^='/']", [
        displayNameLink,
        handleLink,
        selfLink,
        viewsLink,
        quotesLink,
      ], target);

    const snapshot = xAdapter().extract(reader);

    expect(snapshot.authors).toEqual(["NASA @NASA"]);
    expect(snapshot.published_at).toBe("2026-04-03T13:32:06.000Z");
    expect(snapshot.title).toBeUndefined();
    expect(snapshot.blocks).toEqual([
      { type: "paragraph", text: `${sourcePrefix} View quotes (${TARGET_URL}/quotes) ${sourceMiddle} 77.6M Views (${TARGET_URL}/analytics) ${sourceSuffix}` },
      { type: "paragraph", text: "·" },
      { type: "image", asset_id: "x:image:001" },
    ]);
    const delivered = JSON.stringify(snapshot.blocks);
    expect(delivered.match(/View quotes/g)).toHaveLength(1);
    expect(delivered.match(/77\.6M Views/g)).toHaveLength(1);
    expect(delivered.match(/ALT/g)).toHaveLength(1);
    expect(delivered).not.toContain("Replies");
    expect(delivered).not.toContain("sibling reply");
  });

  it("extracts a plain text-only post without relying on media or engagement UI", () => {
    const text = "A complete source-authored text-only X post remains readable without a title or media asset.";
    const body = node("x-text-only-body", "div", text, { "data-testid": "tweetText" }, [node("x-text-only-value", "#text", text)]);
    const author = node("x-text-only-author", "div", "Text Author @textauthor", { "data-testid": "User-Name" });
    const time = node("x-text-only-time", "time", "Apr 3, 2026", { datetime: "2026-04-03T13:32:06.000Z" });
    const selfLink = node("x-text-only-link", "a", "Apr 3, 2026", { href: "/textauthor/status/2040059770237849635", role: "link" }, [time]);
    const target = node("x-text-only-target", "article", `${text} Text Author @textauthor`, { "data-testid": "tweet" }, [author, body, selfLink]);
    const reader = new FixturePageReader("https://x.com/textauthor/status/2040059770237849635", text)
      .add(TWEET_ROOT, [target])
      .add(STATUS_LINK, [selfLink], target)
      .add(TWEET_TEXT, [body], target)
      .add(USER_NAME, [author], target)
      .add(TIME, [time], target)
      .add(TIME_LINK, [selfLink], target);

    const snapshot = xAdapter().extract(reader);

    expect(snapshot.title).toBeUndefined();
    expect(snapshot.blocks).toEqual([{ type: "paragraph", text }]);
    expect(snapshot.assets).toEqual([]);
    expect(snapshot.authors).toEqual(["Text Author @textauthor"]);
    expect(snapshot.warnings).not.toContain("ADAPTER_CHANGED");
  });
});
