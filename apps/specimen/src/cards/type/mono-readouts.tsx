// Port of guidelines/mono-readouts.card.html.
export default function Card() {
  return (
    <div className="one">
      <table style={{ fontSize: 13, width: "auto" }}>
        <tbody>
          <tr><th>Focal length</th><th>Sensor</th><th>Position</th><th>Time</th></tr>
          <tr><td>24 mm</td><td>36 × 24 mm</td><td>52.5200° N · 13.4050° E</td><td>14:32:08</td></tr>
          <tr><td>135 mm</td><td>23.5 × 15.6 mm</td><td>48.1351° N · 11.5820° E</td><td>06:05:11</td></tr>
        </tbody>
      </table>
    </div>
  );
}
