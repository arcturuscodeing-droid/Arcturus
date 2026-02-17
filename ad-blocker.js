;(() => {
  function isAdBlockerEnabled() {
    return localStorage.getItem("adBlockerEnabled") !== "false"
  }

  const whitelistedDomains = [
    window.location.hostname,
    "Natrix",
    "natrix",
    "api.themoviedb.org",
    "image.tmdb.org",
    "themoviedb.org",
    "youtube.com",
    "ko-fi.com",
    "discord.gg",
    // Casting domains
    "gstatic.com",
    "www.gstatic.com",
    "cast.google.com",
    "google.com",
    // Video Source Domains
    "febbox-seven.vercel.app",
    "flixy.watch",
    "mappletv.uk",
    "pstream.mov",
    "iframe.pstream.mov",
    "multiembed.mov",
    "moviesapi.club",
    "embed.su",
    "hexa.watch",
    "vidlink.pro",
    "vidsrc.xyz",
    "vidsrc.rip",
    "vidsrc.su",
    "vidsrc.vip",
    "vidsrc.cc",
    "vidsrc.cx",
    "2embed.cc",
    "www.2embed.cc",
    "123embed.net",
    "play2.123embed.net",
    "111movies.com",
    "smashy.stream",
    "player.smashy.stream",
    "autoembed.cc",
    "player.autoembed.cc",
    "videasy.net",
    "player.videasy.net",
    "vidfast.pro",
    "vidify.top",
    "flicky.host",
    "rivestream.org",
    "vidora.su",
    "streamflix.one",
    "watch.streamflix.one",
    "nebulaflix.stream",
    "vidjoy.pro",
    "vidzee.wtf",
    "player.vidzee.wtf",
    "spencerdevs.xyz",
    "frembed.icu",
    "hds.yoturkish.app",
    "uembed.xyz",
  ]

  const blockedDomains = [
    "all",
    "googleadservices.com",
    "golchhait.com",
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "google-analytics.com",
    "googletagmanager.com",
    "facebook.net",
    "connect.facebook.net",
    "adservice.google.com",
    "pagead2.googlesyndication.com",
    "tpc.googlesyndication.com",
    "ads.youtube.com",
    "ads.google.com",
    "adclick.g.doubleclick.net",
    "media.admob.com",
    "static.doubleclick.net",
    "taboola.com",
    "outbrain.com",
    "advertising.com",
    "adnxs.com",
    "adsrvr.org",
    "criteo.com",
    "pubmatic.com",
    "rubiconproject.com",
    "openx.net",
    "amazon-adsystem.com",
    "scorecardresearch.com",
    "quantserve.com",
    "hotjar.com",
    "mouseflow.com",
    "crazyegg.com",
    "luckyorange.com",
    // Streaming site ad domains
    "popads.net",
    "popcash.net",
    "propellerads.com",
    "adcash.com",
    "exoclick.com",
    "juicyads.com",
    "trafficjunky.com",
    "plugrush.com",
    "adsterra.com",
    "hilltopads.net",
    "clickadu.com",
    "bidvertiser.com",
    "revcontent.com",
    "mgid.com",
    "zeroredirect",
    "redirect",
    "popunder",
    "pop-under",
    "playerhq",
    "playeverlustinglife.space",
    "evshobbiesusa.com",
    "a46e0368.forwarding-request-consent.pages.dev",
    "mod-lighting.com",
    "greatbharatspares.com",
    "golchhait.com",
    "gotlaptopparts.com",
    "fmshobby.com",
    "awin1.com",
    "amazon.com",
    "adserver.",
    "zoneid",
    "bannerid",
    "campaignid",
    "click_id",
    "c4thl3k.php",
    "adformat=onclick",
    "adformat=onmouseover",
    "adformat=onfocus",
    "adformat=onblur",
    "adformat=onload",
    "adformat=onunload",
    "adformat=onscroll",
    "adformat=onresize",
    "adformat=onchange",
    "lighthouseco.com",
    "lampsusa.com",
  ]

  function isWhitelisted(url) {
    if (!url) return false
    try {
      const urlObj = new URL(url, window.location.href)
      const hostname = urlObj.hostname
      return whitelistedDomains.some(
        (domain) => hostname === domain || hostname.endsWith("." + domain),
      )
    } catch {
      return false
    }
  }

  function isBlocked(url) {
    if (!url) return false
    const urlLower = url.toLowerCase()
    return blockedDomains.some((domain) => urlLower.includes(domain.toLowerCase()))
  }

  function isAllowed(url) {
    if (!url) return false
    // Always allow same-origin requests
    if (url.startsWith(window.location.origin)) return true
    // Whitelist takes absolute priority
    if (isWhitelisted(url)) return true
    return false
  }

  function blockAdScripts() {
    if (!isAdBlockerEnabled()) return

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === "SCRIPT") {
            const src = node.src || node.getAttribute("src")
            if (src && !isAllowed(src) && !src.startsWith(window.location.origin)) {
              console.log("[Natrix Ad Blocker] Blocked script:", src)
              node.remove()
            }
          }
          if (node.tagName === "IFRAME") {
            const src = node.src || node.getAttribute("src")
            if (src && !isAllowed(src) && !src.startsWith(window.location.origin)) {
              console.log("[Natrix Ad Blocker] Blocked iframe:", src)
              node.remove()
            }
          }
        })
      })
    })

    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  function blockPopups() {
    if (!isAdBlockerEnabled()) return

    const originalWindowOpen = window.open
    window.open = (url, name, specs) => {
      if (url && isAllowed(url)) return originalWindowOpen.call(window, url, name, specs)
      console.log("[Natrix Ad Blocker] Blocked popup:", url)
      return { closed: true, close() {}, focus() {}, blur() {}, postMessage() {}, location: { href: "" } }
    }

    window.addEventListener(
      "blur",
      (e) => {
        window.focus()
        e.stopPropagation()
        e.preventDefault()
      },
      true,
    )

    const checkForOverlays = () => {
      document.querySelectorAll("*").forEach((el) => {
        const style = window.getComputedStyle(el)
        if (
          style.position === "fixed" &&
          Number.parseInt(style.zIndex) > 999 &&
          el.tagName !== "VIDEO" &&
          el.tagName !== "CANVAS" &&
          !el.closest("nav") &&
          !el.closest("header")
        ) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 200 && rect.height > 200) {
            console.log("[Natrix Ad Blocker] Removed overlay element")
            el.remove()
          }
        }
      })
    }

    if (window.innerWidth > 768) setInterval(checkForOverlays, 1000)
  }

  function blockAdRequests() {
    if (!isAdBlockerEnabled()) return

    const originalFetch = window.fetch
    window.fetch = function (url, options) {
      const urlStr = typeof url === "string" ? url : url.url
      if (!isAllowed(urlStr)) {
        console.log("[Natrix Ad Blocker] Blocked fetch request:", urlStr)
        return Promise.reject(new Error("Blocked by Natrix Ad Blocker"))
      }
      return originalFetch.apply(this, arguments)
    }

    const originalXHROpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      if (!isAllowed(url)) {
        console.log("[Natrix Ad Blocker] Blocked XHR request:", url)
        throw new Error("Blocked by Natrix Ad Blocker")
      }
      return originalXHROpen.apply(this, arguments)
    }
  }

  function blockRedirects() {
    if (!isAdBlockerEnabled()) return

    const safeRedirect = (url, type) => {
      if (!isAllowed(url)) {
        console.log(`[Natrix Ad Blocker] Blocked redirect (${type}):`, url)
        return
      }
      window.location.href = url
    }

    window.location.assign = (url) => safeRedirect(url, "assign")
    window.location.replace = (url) => safeRedirect(url, "replace")

    const hrefDescriptor = Object.getOwnPropertyDescriptor(Location.prototype, "href")
    if (hrefDescriptor && hrefDescriptor.set) {
      Object.defineProperty(Location.prototype, "href", {
        set(url) {
          if (!isAllowed(url)) {
            console.log("[Natrix Ad Blocker] Blocked redirect (href):", url)
            return
          }
          hrefDescriptor.set.call(this, url)
        },
        get: hrefDescriptor.get,
      })
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) =>
        m.addedNodes.forEach((n) => {
          if (n.tagName === "META" && n.getAttribute("http-equiv") === "refresh") n.remove()
        }),
      )
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  function blockNavigation() {
    if (!isAdBlockerEnabled()) return

    document.addEventListener(
      "click",
      (e) => {
        let target = e.target
        while (target && target.tagName !== "A" && target !== document.body) {
          target = target.parentElement
        }

        if (target && target.tagName === "A") {
          const href = target.getAttribute("href") || target.href
          const targetAttr = target.getAttribute("target")
          const opensNewWindow = targetAttr === "_blank" || targetAttr === "_new"

          if (href && href !== "#") {
            if (!isAllowed(href) && !href.startsWith(window.location.origin)) {
              console.log("[Natrix Ad Blocker] Blocked navigation:", href)
              e.stopPropagation()
              e.preventDefault()
              return false
            }

            if (opensNewWindow && !isWhitelisted(href)) {
              console.log("[Natrix Ad Blocker] Blocked popup link:", href)
              e.stopPropagation()
              e.preventDefault()
              return false
            }
          }
        }
      },
      true,
    )

    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target
        if (form && form.tagName === "FORM") {
          const action = form.getAttribute("action") || form.action
          if (action && !isAllowed(action) && !action.startsWith(window.location.origin)) {
            console.log("[Natrix Ad Blocker] Blocked form submission:", action)
            e.stopPropagation()
            e.preventDefault()
            return false
          }
        }
      },
      true,
    )
  }

  function init() {
    if (!isAdBlockerEnabled()) return console.log("[Natrix Ad Blocker] Disabled")

    console.log("[Natrix Ad Blocker] Initializing (mobile-safe)")
    blockAdScripts()
    blockPopups()
    blockRedirects()
    blockAdRequests()
    blockNavigation()
    console.log("[Natrix Ad Blocker] Active")
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init)
  else init()

  window.addEventListener("load", init)
  window.addEventListener("storage", (e) => {
    if (e.key === "adBlockerEnabled") init()
  })
})()