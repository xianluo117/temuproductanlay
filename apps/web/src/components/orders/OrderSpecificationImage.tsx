import { useEffect, useState } from "react";

interface Props {
  urls: string[];
  width?: number;
  height?: number;
}

export function OrderSpecificationImage({
  urls,
  width = 48,
  height = 48,
}: Props) {
  const candidates = [...new Set(urls.filter(Boolean))];
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates.join("\n")]);

  const currentUrl = candidates[candidateIndex];
  if (!currentUrl) {
    return (
      <div
        className="image-placeholder"
        style={{ width, height, flex: `0 0 ${width}px` }}
        aria-label="暂无规格图片"
      />
    );
  }

  return (
    <img
      src={currentUrl}
      width={width}
      height={height}
      alt="订单规格"
      style={{ display: "block", objectFit: "cover", borderRadius: 6 }}
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  );
}
