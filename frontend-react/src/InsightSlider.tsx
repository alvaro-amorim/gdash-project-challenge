import { useEffect, useState } from 'react';

export function InsightSlider({ text }: { text: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const [msgList, setMsgList] = useState<string[]>([]);

  useEffect(() => {
    const newMessages = text
      .split(/[.!]\s+/)
      .filter(Boolean)
      .map((message) => message.replace(/[.!]$/, '') + '.');

    if (msgList.length === 0) {
      setMsgList(newMessages);
      setCurrentIndex(0);
      return;
    }

    if (JSON.stringify(newMessages) !== JSON.stringify(msgList)) {
      setFade(false);
      const timer = setTimeout(() => {
        setMsgList(newMessages);
        setCurrentIndex(0);
        setFade(true);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [msgList, text]);

  useEffect(() => {
    if (msgList.length <= 1) {
      return;
    }

    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setCurrentIndex((previousIndex) => (previousIndex + 1) % msgList.length);
        setFade(true);
      }, 500);
    }, 15000);

    return () => clearInterval(interval);
  }, [msgList]);

  return (
    <div className="flex min-h-[5.5rem] items-center">
      <p
        className={`text-xl font-medium leading-snug text-white transition-all duration-500 sm:text-2xl ${
          fade ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
      >
        "{msgList[currentIndex] || 'Aguardando analise...'}"
      </p>
    </div>
  );
}
