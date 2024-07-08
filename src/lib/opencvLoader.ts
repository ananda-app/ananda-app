let isOpenCvLoaded = false;

export async function loadOpenCv(uri: string): Promise<void> {
  if (isOpenCvLoaded) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const tag: HTMLScriptElement = document.createElement("script")
    tag.src = uri
    tag.async = true
    tag.type = "text/javascript"
    tag.onload = () => {
      (window as any).cv["onRuntimeInitialized"] = () => {
        isOpenCvLoaded = true;
        resolve()
      }
    }
    tag.onerror = () => {
      reject(new URIError("opencv didn't load correctly."))
    }
    const firstScriptTag = document.getElementsByTagName("script")[0]
    if (firstScriptTag?.parentNode) {
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
    } else {
      document.head.appendChild(tag)
    }
  })
}